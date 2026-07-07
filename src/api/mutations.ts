import type { Status, Task } from '../types';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useToast } from '../contexts/ToastContext';
import { moveTask } from '../lib/tasks';
import { updateTask } from './client';
import { taskQueries } from './queries';

interface MoveTaskInput {
  id: string;
  status: Status;
  version: number;
}

interface MoveTaskContext {
  previousTask: Task | undefined;
}

export function useMoveTask() {
  const queryClient = useQueryClient();
  const { addToast } = useToast();

  return useMutation<Task, Error, MoveTaskInput, MoveTaskContext>({
    mutationFn: ({ id, status, version }) => updateTask(id, { status, version }),

    onMutate: async ({ id, status }) => {
      /**  진행 중인 refetch가 낙관적 반영 이후 도착해 덮어쓰는 것을 방지 */
      await queryClient.cancelQueries({ queryKey: taskQueries.lists() });

      const previousTask = queryClient
        .getQueryData(taskQueries.list().queryKey)
        ?.find(task => task.id === id);
      queryClient.setQueryData(taskQueries.list().queryKey, prev =>
        prev && moveTask(prev, id, status));

      return { previousTask };
    },

    /**  롤백 대상을 이동시킨 카드 하나로 한정해, 동시에 진행 중인 다른 카드의 변경을 건드리지 않는다 */
    onError: (_error, { id }, context) => {
      const previousTask = context?.previousTask;
      if (previousTask) {
        queryClient.setQueryData(taskQueries.list().queryKey, prev =>
          prev?.map(task => (task.id === id ? previousTask : task)));
      }
      addToast('이동에 실패했습니다.', 'error');
    },

    onSuccess: (updatedTask) => {
      // TODO(#8): 오래된 응답이 최신 상태를 덮어쓸 수 있음 — 같은 카드를 연속 이동시킬 때
      // 앞선 요청의 onError 롤백이 뒤에 성공한 onSuccess 결과를 덮어쓰는 경로도 포함해서
      // 처리 필요 (경쟁 상태 처리는 별도 이슈에서 진행)
      queryClient.setQueryData(taskQueries.list().queryKey, prev =>
        prev?.map(task => (task.id === updatedTask.id ? updatedTask : task)));
    },
  });
}
