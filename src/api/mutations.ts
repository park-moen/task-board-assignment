import type { QueryClient } from '@tanstack/react-query';
import type { Priority, Status, Task } from '../types';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useToast } from '../contexts/ToastContext';
import { getConflictServerTask, toFailureToastMessage } from '../lib/errors';
import { addTask, insertTaskAt, moveTask, removeTask, updateTaskFields } from '../lib/tasks';
import { ApiError, createTask, deleteTask, updateTask } from './client';
import { taskQueries } from './queries';

/**
 * 409 충돌로 받은 서버 최신 상태는 이 뮤테이션이 낙관적으로 반영한 값이
 * 아직 캐시에 남아 있을 때만 적용한다.
 *
 * scope로 요청은 직렬화되지만 onMutate는 즉시 실행되므로, 대기 중에도 같은 태스크에 대한
 * 더 최신 낙관적 상태가 캐시에 반영될 수 있다. 이 경우 오래된 실패 응답이 최신 상태를
 * 덮어쓰지 않도록 서버 상태 적용을 건너뛴다.
 */
function applyServerSnapshotIfStillApplied(
  queryClient: QueryClient,
  id: string,
  serverTask: Task,
  isStillApplied: (task: Task) => boolean,
) {
  queryClient.setQueryData(taskQueries.list().queryKey, prev =>
    prev?.map(task => (task.id === id && isStillApplied(task) ? serverTask : task)));
}

interface MoveTaskInput {
  id: string;
  status: Status;
}

interface MoveTaskContext {
  previousTask: Task | undefined;
  appliedStatus: Status;
}

export function useMoveTask() {
  const queryClient = useQueryClient();
  const { addToast } = useToast();

  // useMutation()은 scope가 훅 생성 시점에 고정되어 태스크별로 다르게 줄 수 없어서,
  // 호출마다 getMutationCache().build()로 새 뮤테이션을 만들어 태스크 id를 scope로 부여한다.
  const mutate = useCallback(({ id, status }: MoveTaskInput) => {
    const mutation = queryClient.getMutationCache().build<Task, Error, MoveTaskInput, MoveTaskContext>(
      queryClient,
      {
        // 같은 태스크(id)에 대한 뮤테이션은 직렬로 실행되어, 응답 순서가 요청 순서와 어긋나는 경쟁 상태를 방지
        scope: { id },

        mutationFn: (variables) => {
          // scope로 대기하다 실행되는 시점의 최신 version을 읽어야 함 (dispatch 시점 값은 앞선 요청으로 낡았을 수 있음)
          const current = queryClient
            .getQueryData(taskQueries.list().queryKey)
            ?.find(task => task.id === variables.id);
          // 요청이 대기하는 동안 태스크가 삭제되어 캐시에서 사라졌을 수 있으므로 명시적으로 실패 처리한다.
          if (!current) {
            return Promise.reject(new ApiError(404, `카드를 찾을 수 없습니다. (id: ${variables.id})`, null));
          }
          return updateTask(variables.id, { status: variables.status, version: current.version });
        },

        onMutate: async (variables) => {
          /**  진행 중인 refetch가 낙관적 반영 이후 도착해 덮어쓰는 것을 방지 */
          await queryClient.cancelQueries({ queryKey: taskQueries.lists() });

          const previousTask = queryClient
            .getQueryData(taskQueries.list().queryKey)
            ?.find(task => task.id === variables.id);
          queryClient.setQueryData(taskQueries.list().queryKey, prev =>
            prev && moveTask(prev, variables.id, variables.status));

          return { previousTask, appliedStatus: variables.status };
        },

        // 실패해도 서버의 version은 롤백되지 않으므로, 로컬 version을 되돌리면 이후 요청이 낡은 version으로 409를 유발할 수 있다.
        // 현재 status가 이 뮤테이션이 적용한 값(appliedStatus)과 같을 때만 되돌린다.
        // 그 사이 반영된 더 최신 이동 상태를 오래된 실패 응답이 덮어쓰지 않도록 하기 위함이다.
        onError: (error, variables, context) => {
          const serverTask = getConflictServerTask(error);
          // 409(버전 충돌)는 로컬 스냅샷으로 롤백하지 않고, 조건이 맞을 때 서버 최신 상태를 캐시에 반영한다.
          if (serverTask) {
            applyServerSnapshotIfStillApplied(
              queryClient,
              variables.id,
              serverTask,
              task => task.status === context?.appliedStatus,
            );
            addToast('다른 곳에서 먼저 변경되어 최신 내용으로 갱신했습니다.', 'error');

            return;
          }

          const previousTask = context?.previousTask;
          if (previousTask) {
            queryClient.setQueryData(taskQueries.list().queryKey, prev =>
              prev?.map((task) => {
                if (task.id !== variables.id || task.status !== context.appliedStatus)
                  return task;
                return { ...task, status: previousTask.status };
              }));
          }
          addToast(toFailureToastMessage(error, '이동에 실패했습니다.'), 'error');
        },

        // status는 건드리지 않고 version/updatedAt만 반영 — 안 그러면 더 최신 낙관적 상태를 오래된 응답이 덮어씀
        onSuccess: (updatedTask) => {
          queryClient.setQueryData(taskQueries.list().queryKey, prev =>
            prev?.map(task => (task.id === updatedTask.id
              ? { ...task, version: updatedTask.version, updatedAt: updatedTask.updatedAt }
              : task)));
        },
      },
    );

    // 에러는 onError에서 이미 처리(롤백 + Toast)하므로, 여기서는 unhandled rejection만 방지
    mutation.execute({ id, status }).catch(() => {});
  }, [queryClient, addToast]);

  return { mutate };
}

interface CreateTaskInput {
  title: string;
  priority: Priority;
  description?: string;
}

interface CreateTaskContext {
  tempId: string;
}

/** 낙관적 생성 — 실제 id/version이 없는 임시 태스크를 만들어 즉시 반영하고, 성공 시 서버 값으로 교체한다. */
export function useCreateTask() {
  const queryClient = useQueryClient();
  const { addToast } = useToast();

  return useMutation<Task, Error, CreateTaskInput, CreateTaskContext>({
    mutationFn: input => createTask(input),

    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: taskQueries.lists() });

      const tempId = `temp-${crypto.randomUUID()}`;
      const now = new Date().toISOString();
      const optimisticTask: Task = {
        id: tempId,
        title: input.title,
        description: input.description,
        status: 'todo',
        priority: input.priority,
        tags: [],
        createdAt: now,
        updatedAt: now,
        version: 1,
      };
      queryClient.setQueryData(taskQueries.list().queryKey, prev => prev && addTask(prev, optimisticTask));

      return { tempId };
    },

    onError: (error, _input, context) => {
      if (context?.tempId) {
        const tempId = context.tempId;
        queryClient.setQueryData(taskQueries.list().queryKey, prev => prev && removeTask(prev, tempId));
      }
      addToast(toFailureToastMessage(error, '생성에 실패했습니다.'), 'error');
    },

    // 임시 태스크를 서버가 확정한 태스크(id/version 포함)로 교체한다.
    onSuccess: (createdTask, _input, context) => {
      queryClient.setQueryData(taskQueries.list().queryKey, prev =>
        prev?.map(task => (task.id === context.tempId ? createdTask : task)));
    },
  });
}

interface UpdateTaskInput {
  id: string;
  title: string;
  priority: Priority;
  description?: string;
}

interface UpdateTaskContext {
  previousTask: Task | undefined;
  appliedFields: Pick<Task, 'title' | 'priority' | 'description'>;
}

/** 낙관적 수정 — useMoveTask와 동일하게 태스크별 scope로 드래그/삭제와의 경쟁을 방지한다. */
export function useUpdateTask() {
  const queryClient = useQueryClient();
  const { addToast } = useToast();

  const mutate = useCallback((input: UpdateTaskInput) => {
    const mutation = queryClient.getMutationCache().build<Task, Error, UpdateTaskInput, UpdateTaskContext>(
      queryClient,
      {
        scope: { id: input.id },

        mutationFn: (variables) => {
          const current = queryClient
            .getQueryData(taskQueries.list().queryKey)
            ?.find(task => task.id === variables.id);
          if (!current) {
            return Promise.reject(new ApiError(404, `카드를 찾을 수 없습니다. (id: ${variables.id})`, null));
          }
          return updateTask(variables.id, {
            title: variables.title,
            priority: variables.priority,
            description: variables.description,
            version: current.version,
          });
        },

        onMutate: async (variables) => {
          await queryClient.cancelQueries({ queryKey: taskQueries.lists() });

          const previousTask = queryClient
            .getQueryData(taskQueries.list().queryKey)
            ?.find(task => task.id === variables.id);
          const appliedFields = {
            title: variables.title,
            priority: variables.priority,
            description: variables.description,
          };
          queryClient.setQueryData(taskQueries.list().queryKey, prev =>
            prev && updateTaskFields(prev, variables.id, appliedFields));

          return { previousTask, appliedFields };
        },

        // 현재 필드값이 이 뮤테이션이 적용한 값과 같을 때만 되돌린다.
        // 그 사이 반영된 더 최신 수정 값을 오래된 실패 응답이 덮어쓰지 않도록 하기 위함이다.
        onError: (error, variables, context) => {
          const serverTask = getConflictServerTask(error);
          // 409(버전 충돌)는 로컬 스냅샷으로 롤백하지 않고, 조건이 맞을 때 서버 최신 상태를 캐시에 반영한다.
          if (serverTask) {
            applyServerSnapshotIfStillApplied(
              queryClient,
              variables.id,
              serverTask,
              (task) => {
                const appliedFields = context?.appliedFields;
                return !!appliedFields
                  && task.title === appliedFields.title
                  && task.priority === appliedFields.priority
                  && task.description === appliedFields.description;
              },
            );
            addToast('다른 곳에서 먼저 변경되어 최신 내용으로 갱신했습니다.', 'error');
            return;
          }

          const previousTask = context?.previousTask;
          if (previousTask) {
            queryClient.setQueryData(taskQueries.list().queryKey, prev =>
              prev?.map((task) => {
                if (task.id !== variables.id)
                  return task;
                const stillApplied = task.title === context.appliedFields.title
                  && task.priority === context.appliedFields.priority
                  && task.description === context.appliedFields.description;
                if (!stillApplied)
                  return task;
                return {
                  ...task,
                  title: previousTask.title,
                  priority: previousTask.priority,
                  description: previousTask.description,
                };
              }));
          }
          addToast(toFailureToastMessage(error, '수정에 실패했습니다.'), 'error');
        },

        onSuccess: (updatedTask) => {
          queryClient.setQueryData(taskQueries.list().queryKey, prev =>
            prev?.map(task => (task.id === updatedTask.id
              ? { ...task, version: updatedTask.version, updatedAt: updatedTask.updatedAt }
              : task)));
        },
      },
    );

    mutation.execute(input).catch(() => {});
  }, [queryClient, addToast]);

  return { mutate };
}

interface DeleteTaskContext {
  previousTask: Task | undefined;
  previousIndex: number;
}

/** 낙관적 삭제 — 실패 시 스냅샷을 다시 목록에 넣어 복원한다. */
export function useDeleteTask() {
  const queryClient = useQueryClient();
  const { addToast } = useToast();

  const mutate = useCallback((id: string) => {
    const mutation = queryClient.getMutationCache().build<void, Error, string, DeleteTaskContext>(
      queryClient,
      {
        scope: { id },

        mutationFn: taskId => deleteTask(taskId),

        onMutate: async (taskId) => {
          await queryClient.cancelQueries({ queryKey: taskQueries.lists() });

          const list = queryClient.getQueryData(taskQueries.list().queryKey) ?? [];
          const previousIndex = list.findIndex(task => task.id === taskId);
          const previousTask = list[previousIndex];
          queryClient.setQueryData(taskQueries.list().queryKey, prev => prev && removeTask(prev, taskId));

          return { previousTask, previousIndex };
        },

        onError: (error, _taskId, context) => {
          const previousTask = context?.previousTask;
          if (previousTask) {
            queryClient.setQueryData(taskQueries.list().queryKey, (prev) => {
              if (!prev)
                return prev;
              // 이미 목록에 있으면(중복 처리 등) 다시 추가하지 않음
              if (prev.some(task => task.id === previousTask.id))
                return prev;
              // 원래 있던 위치에 복원 — addTask는 항상 맨 앞에 넣으므로 삭제 롤백에는 맞지 않음
              return insertTaskAt(prev, context.previousIndex, previousTask);
            });
          }
          addToast(toFailureToastMessage(error, '삭제에 실패했습니다.'), 'error');
        },
      },
    );

    mutation.execute(id).catch(() => {});
  }, [queryClient, addToast]);

  return { mutate };
}
