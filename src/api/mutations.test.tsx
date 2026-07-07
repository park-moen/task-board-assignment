import type { ReactNode } from 'react';
import type { Task } from '../types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { updateTask } from './client';
import { useMoveTask } from './mutations';
import { taskQueries } from './queries';

vi.mock('../contexts/ToastContext', () => ({ useToast: () => ({ addToast: vi.fn() }) }));
vi.mock('./client', () => ({ updateTask: vi.fn() }));

function make(id: string, over: Partial<Task> = {}): Task {
  return {
    id,
    title: `Task ${id}`,
    status: 'todo',
    priority: 'medium',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    version: 1,
    ...over,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('useMoveTask (동시 이동 경쟁 상태)', () => {
  beforeEach(() => {
    vi.mocked(updateTask).mockReset();
  });

  it('카드 A 이동 실패가, 이미 성공한 카드 B의 변경을 되돌리지 않는다', async () => {
    const queryClient = new QueryClient();
    const taskA = make('a');
    const taskB = make('b');

    queryClient.setQueryData(taskQueries.list().queryKey, [taskA, taskB]);

    const requestA = deferred<Task>();
    const requestB = deferred<Task>();
    vi.mocked(updateTask)
      .mockReturnValueOnce(requestA.promise)
      .mockReturnValueOnce(requestB.promise);

    function Wrapper({ children }: { children: ReactNode }) {
      return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
    }

    const { result } = renderHook(() => useMoveTask(), { wrapper: Wrapper });

    act(() => {
      result.current.mutate({ id: 'a', status: 'in-progress', version: 1 });
      result.current.mutate({ id: 'b', status: 'done', version: 1 });
    });

    await act(async () => {
      requestB.resolve({ ...taskB, status: 'done', version: 2 });
    });
    await waitFor(() => {
      const tasks = queryClient.getQueryData(taskQueries.list().queryKey);
      expect(tasks?.find(t => t.id === 'b')?.status).toBe('done');
    });

    await act(async () => {
      requestA.reject(new Error('network error'));
    });
    await waitFor(() => {
      const finalTasks = queryClient.getQueryData(taskQueries.list().queryKey);
      expect(finalTasks?.find(t => t.id === 'b')?.status).toBe('done');
    });
  });
});
