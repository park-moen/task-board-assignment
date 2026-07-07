import type { ReactNode } from 'react';
import type { Task } from '../types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTask, deleteTask, updateTask } from './client';
import { useCreateTask, useDeleteTask, useMoveTask, useUpdateTask } from './mutations';
import { taskQueries } from './queries';

vi.mock('../contexts/ToastContext', () => ({ useToast: () => ({ addToast: vi.fn() }) }));
vi.mock('./client', () => ({ createTask: vi.fn(), updateTask: vi.fn(), deleteTask: vi.fn() }));

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

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
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

    const { result } = renderHook(() => useMoveTask(), { wrapper: createWrapper(queryClient) });

    act(() => {
      result.current.mutate({ id: 'a', status: 'in-progress' });
      result.current.mutate({ id: 'b', status: 'done' });
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

  it('같은 카드를 빠르게 연속 이동하면 요청이 직렬화되고, 최신 낙관적 상태가 오래된 응답에 덮어써지지 않는다', async () => {
    const queryClient = new QueryClient();
    const taskX = make('x');
    queryClient.setQueryData(taskQueries.list().queryKey, [taskX]);

    const requestA = deferred<Task>();
    const requestB = deferred<Task>();
    const calls: Array<{ id: string; patch: Partial<Task> & { version: number } }> = [];
    vi.mocked(updateTask).mockImplementation((id, patch) => {
      calls.push({ id, patch });
      return calls.length === 1 ? requestA.promise : requestB.promise;
    });

    const { result } = renderHook(() => useMoveTask(), { wrapper: createWrapper(queryClient) });
    const getTaskX = () =>
      queryClient.getQueryData<Task[]>(taskQueries.list().queryKey)?.find(t => t.id === 'x');

    // A: todo -> in-progress (onMutate가 cancelQueries를 await하므로 act(async)로 감쌈)
    await act(async () => {
      result.current.mutate({ id: 'x', status: 'in-progress' });
    });
    // B: in-progress -> done (A 응답 전에 연속 드래그)
    await act(async () => {
      result.current.mutate({ id: 'x', status: 'done' });
    });

    // 낙관적 반영은 즉시 이루어져 화면엔 이미 'done'
    expect(getTaskX()?.status).toBe('done');
    // scope 덕분에 B의 실제 요청은 아직 나가지 않음
    expect(calls).toHaveLength(1);

    // A 성공 (서버 version 2로 확정)
    await act(async () => {
      requestA.resolve({ ...taskX, status: 'in-progress', version: 2 });
    });

    // A의 오래된 응답이 B가 이미 반영한 'done'을 덮어쓰면 안 됨
    await waitFor(() => expect(getTaskX()?.status).toBe('done'));

    // B는 이제 실행되며, dispatch 시점이 아니라 A 이후 캐시의 최신 version(2)을 사용해야 함
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1].patch.version).toBe(2);

    // B 성공
    await act(async () => {
      requestB.resolve({ ...taskX, status: 'done', version: 3 });
    });
    await waitFor(() => {
      expect(getTaskX()?.status).toBe('done');
      expect(getTaskX()?.version).toBe(3);
    });
  });

  it('앞선 요청이 성공해 version이 오른 뒤 다음 요청이 실패해도, 그 성공한 version을 되돌리지 않는다', async () => {
    const queryClient = new QueryClient();
    const taskX = make('x');
    queryClient.setQueryData(taskQueries.list().queryKey, [taskX]);

    const r1 = deferred<Task>();
    const r2 = deferred<Task>();
    const r3 = deferred<Task>();
    const calls: Array<{ status: string; version: number }> = [];
    vi.mocked(updateTask).mockImplementation((_id, patch) => {
      calls.push({ status: patch.status as string, version: patch.version! });
      if (calls.length === 1)
        return r1.promise;
      return calls.length === 2 ? r2.promise : r3.promise;
    });

    const { result } = renderHook(() => useMoveTask(), { wrapper: createWrapper(queryClient) });
    const getTaskX = () =>
      queryClient.getQueryData<Task[]>(taskQueries.list().queryKey)?.find(t => t.id === 'x');

    // todo -> in-progress -> done -> todo, 세 번 빠르게 연속 이동
    await act(async () => {
      result.current.mutate({ id: 'x', status: 'in-progress' });
    }); // M1
    await act(async () => {
      result.current.mutate({ id: 'x', status: 'done' });
    }); // M2
    await act(async () => {
      result.current.mutate({ id: 'x', status: 'todo' });
    }); // M3

    // M1 성공 (서버 version 1 -> 2)
    await act(async () => {
      r1.resolve({ ...taskX, status: 'in-progress', version: 2 });
    });
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1].version).toBe(2); // M2는 M1이 올려둔 최신 version을 사용

    // M2 실패 — 실패해도 M1이 올려둔 version(2)은 그대로 유지되어야 함
    await act(async () => {
      r2.reject(new Error('network error'));
    });
    await waitFor(() => expect(calls).toHaveLength(3));

    // M3는 M2의 실패와 무관하게 여전히 version=2를 사용해야 함(M2의 onError가 되돌리면 안 됨)
    expect(calls[2].version).toBe(2);

    // M2 실패가 M3의 이미 반영된 낙관적 상태('todo')를 되돌리면 안 됨
    expect(getTaskX()?.status).toBe('todo');
  });
});

describe('useCreateTask (낙관적 생성)', () => {
  beforeEach(() => {
    vi.mocked(createTask).mockReset();
  });

  it('성공하면 임시로 추가했던 태스크를 서버가 반환한 실제 태스크로 교체한다', async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(taskQueries.list().queryKey, []);

    const request = deferred<Task>();
    vi.mocked(createTask).mockReturnValue(request.promise);

    const { result } = renderHook(() => useCreateTask(), { wrapper: createWrapper(queryClient) });

    await act(async () => {
      result.current.mutate({ title: '새 태스크', priority: 'high' });
    });

    // 낙관적으로 임시 태스크가 즉시 반영됨
    let tasks = queryClient.getQueryData<Task[]>(taskQueries.list().queryKey);
    expect(tasks).toHaveLength(1);
    expect(tasks?.[0].title).toBe('새 태스크');
    expect(tasks?.[0].id.startsWith('temp-')).toBe(true);

    const serverTask = make('server-1', { title: '새 태스크', priority: 'high' });
    await act(async () => {
      request.resolve(serverTask);
    });

    await waitFor(() => {
      tasks = queryClient.getQueryData<Task[]>(taskQueries.list().queryKey);
      expect(tasks).toHaveLength(1);
      expect(tasks?.[0].id).toBe('server-1');
    });
  });

  it('실패하면 낙관적으로 추가했던 임시 태스크를 제거한다', async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(taskQueries.list().queryKey, []);

    const request = deferred<Task>();
    vi.mocked(createTask).mockReturnValue(request.promise);

    const { result } = renderHook(() => useCreateTask(), { wrapper: createWrapper(queryClient) });

    await act(async () => {
      result.current.mutate({ title: '실패할 태스크', priority: 'low' });
    });

    expect(queryClient.getQueryData<Task[]>(taskQueries.list().queryKey)).toHaveLength(1);

    await act(async () => {
      request.reject(new Error('network error'));
    });

    await waitFor(() => {
      expect(queryClient.getQueryData<Task[]>(taskQueries.list().queryKey)).toHaveLength(0);
    });
  });
});

describe('useUpdateTask (낙관적 수정)', () => {
  beforeEach(() => {
    vi.mocked(updateTask).mockReset();
  });

  it('실패하면 수정 전 필드 값으로 되돌린다', async () => {
    const queryClient = new QueryClient();
    const taskA = make('a', { title: '원래 제목', priority: 'low' });
    queryClient.setQueryData(taskQueries.list().queryKey, [taskA]);

    const request = deferred<Task>();
    vi.mocked(updateTask).mockReturnValue(request.promise);

    const { result } = renderHook(() => useUpdateTask(), { wrapper: createWrapper(queryClient) });
    const getTaskA = () =>
      queryClient.getQueryData<Task[]>(taskQueries.list().queryKey)?.find(t => t.id === 'a');

    await act(async () => {
      result.current.mutate({ id: 'a', title: '바뀐 제목', priority: 'high' });
    });

    expect(getTaskA()?.title).toBe('바뀐 제목');

    await act(async () => {
      request.reject(new Error('network error'));
    });

    await waitFor(() => {
      expect(getTaskA()?.title).toBe('원래 제목');
      expect(getTaskA()?.priority).toBe('low');
    });
  });

  it('성공하면 서버가 반환한 version/updatedAt만 반영한다', async () => {
    const queryClient = new QueryClient();
    const taskA = make('a', { title: '원래 제목' });
    queryClient.setQueryData(taskQueries.list().queryKey, [taskA]);

    const request = deferred<Task>();
    vi.mocked(updateTask).mockReturnValue(request.promise);

    const { result } = renderHook(() => useUpdateTask(), { wrapper: createWrapper(queryClient) });
    const getTaskA = () =>
      queryClient.getQueryData<Task[]>(taskQueries.list().queryKey)?.find(t => t.id === 'a');

    await act(async () => {
      result.current.mutate({ id: 'a', title: '바뀐 제목', priority: 'high' });
    });

    await act(async () => {
      request.resolve({ ...taskA, title: '바뀐 제목', priority: 'high', version: 2, updatedAt: '2026-01-02T00:00:00.000Z' });
    });

    await waitFor(() => {
      expect(getTaskA()?.version).toBe(2);
      expect(getTaskA()?.title).toBe('바뀐 제목');
    });
  });
});

describe('useDeleteTask (낙관적 삭제)', () => {
  beforeEach(() => {
    vi.mocked(deleteTask).mockReset();
  });

  it('실패하면 삭제했던 태스크를 다시 목록에 복원한다', async () => {
    const queryClient = new QueryClient();
    const taskA = make('a');
    const taskB = make('b');
    queryClient.setQueryData(taskQueries.list().queryKey, [taskA, taskB]);

    const request = deferred<void>();
    vi.mocked(deleteTask).mockReturnValue(request.promise);

    const { result } = renderHook(() => useDeleteTask(), { wrapper: createWrapper(queryClient) });

    await act(async () => {
      result.current.mutate('a');
    });

    // 낙관적으로 즉시 제거됨
    expect(queryClient.getQueryData<Task[]>(taskQueries.list().queryKey)).toHaveLength(1);

    await act(async () => {
      request.reject(new Error('network error'));
    });

    await waitFor(() => {
      const tasks = queryClient.getQueryData<Task[]>(taskQueries.list().queryKey);
      expect(tasks).toHaveLength(2);
      expect(tasks?.find(t => t.id === 'a')).toBeTruthy();
    });
  });

  it('성공하면 제거된 상태를 유지한다', async () => {
    const queryClient = new QueryClient();
    const taskA = make('a');
    queryClient.setQueryData(taskQueries.list().queryKey, [taskA]);

    const request = deferred<void>();
    vi.mocked(deleteTask).mockReturnValue(request.promise);

    const { result } = renderHook(() => useDeleteTask(), { wrapper: createWrapper(queryClient) });

    await act(async () => {
      result.current.mutate('a');
    });

    await act(async () => {
      request.resolve(undefined);
    });

    await waitFor(() => {
      expect(queryClient.getQueryData<Task[]>(taskQueries.list().queryKey)).toHaveLength(0);
    });
  });
});
