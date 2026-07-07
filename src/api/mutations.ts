import type { Priority, Status, Task } from '../types';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useToast } from '../contexts/ToastContext';
import { addTask, insertTaskAt, moveTask, removeTask, updateTaskFields } from '../lib/tasks';
import { createTask, deleteTask, updateTask } from './client';
import { taskQueries } from './queries';

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

  // useMutation()은 scope가 훅 생성 시점에 고정되어 카드별로 다르게 줄 수 없어서,
  // 호출마다 getMutationCache().build()로 새 뮤테이션을 만들어 카드 id를 scope로 부여한다.
  const mutate = useCallback(({ id, status }: MoveTaskInput) => {
    const mutation = queryClient.getMutationCache().build<Task, Error, MoveTaskInput, MoveTaskContext>(
      queryClient,
      {
        // 같은 카드(id)에 대한 뮤테이션은 직렬로 실행되어, 응답 순서가 요청 순서와 어긋나는 경쟁 상태를 방지
        scope: { id },

        mutationFn: (variables) => {
          // scope로 대기하다 실행되는 시점의 최신 version을 읽어야 함 (dispatch 시점 값은 앞선 요청으로 낡았을 수 있음)
          const current = queryClient
            .getQueryData(taskQueries.list().queryKey)
            ?.find(task => task.id === variables.id);
          // 대기 중이던 사이 카드가 삭제되는 등으로 캐시에서 사라졌을 수 있음 — non-null assertion 대신 명시적으로 실패 처리
          if (!current) {
            return Promise.reject(new Error(`카드를 찾을 수 없습니다. (id: ${variables.id})`));
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

        // version은 건드리지 않음 — 실패해도 서버 version은 그대로라, 되돌리면 이미 성공한 다른 요청의 version까지 되돌아가 409가 남
        // status도 appliedStatus(이 뮤테이션이 세팅한 값)와 현재 값이 같을 때만 되돌림 — 더 최신 이동이 이미 반영한 값을 덮어쓰지 않기 위함
        onError: (_error, variables, context) => {
          const previousTask = context?.previousTask;
          if (previousTask) {
            queryClient.setQueryData(taskQueries.list().queryKey, prev =>
              prev?.map((task) => {
                if (task.id !== variables.id || task.status !== context.appliedStatus)
                  return task;
                return { ...task, status: previousTask.status };
              }));
          }
          addToast('이동에 실패했습니다.', 'error');
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

    onError: (_error, _input, context) => {
      if (context?.tempId) {
        const tempId = context.tempId;
        queryClient.setQueryData(taskQueries.list().queryKey, prev => prev && removeTask(prev, tempId));
      }
      addToast('생성에 실패했습니다.', 'error');
    },

    // 임시 태스크를 서버가 실제로 만든 태스크(진짜 id/version)로 교체
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

/** 낙관적 수정 — useMoveTask와 동일하게 카드별 scope로 드래그/삭제와의 경쟁을 방지한다. */
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
            return Promise.reject(new Error(`카드를 찾을 수 없습니다. (id: ${variables.id})`));
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

        // 이 뮤테이션이 적용한 값과 현재 값이 여전히 같을 때만 되돌림 — 더 최신 수정을 덮어쓰지 않기 위함
        onError: (_error, variables, context) => {
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
          addToast('수정에 실패했습니다.', 'error');
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

        onError: (_error, _taskId, context) => {
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
          addToast('삭제에 실패했습니다.', 'error');
        },
      },
    );

    mutation.execute(id).catch(() => {});
  }, [queryClient, addToast]);

  return { mutate };
}
