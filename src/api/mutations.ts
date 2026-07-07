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
  previousTasks: Task[] | undefined;
}

export function useMoveTask() {
  const queryClient = useQueryClient();
  const { addToast } = useToast();

  return useMutation<Task, Error, MoveTaskInput, MoveTaskContext>({
    mutationFn: ({ id, status, version }) => updateTask(id, { status, version }),

    onMutate: async ({ id, status }) => {
      /**  진행 중인 refetch가 낙관적 반영 이후 도착해 덮어쓰는 것을 방지 */
      await queryClient.cancelQueries({ queryKey: taskQueries.lists() });

      const previousTasks = queryClient.getQueryData(taskQueries.list().queryKey);
      queryClient.setQueryData(taskQueries.list().queryKey, prev =>
        prev && moveTask(prev, id, status));

      return { previousTasks };
    },

    onError: (_error, _variables, context) => {
      if (context) {
        queryClient.setQueryData(taskQueries.list().queryKey, context.previousTasks);
      }
      addToast('이동에 실패했습니다.', 'error');
    },

    onSuccess: (updatedTask) => {
      // TODO(#8): 오래된 응답이 최신 상태를 덮어쓸 수 있음 — 경쟁 상태 처리는 별도 이슈에서 진행
      queryClient.setQueryData(taskQueries.list().queryKey, prev =>
        prev?.map(task => (task.id === updatedTask.id ? updatedTask : task)));
    },
  });
}
