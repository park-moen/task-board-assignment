import type { Status, Task } from '../types';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useToast } from '../contexts/ToastContext';
import { moveTask } from '../lib/tasks';
import { updateTask } from './client';
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
