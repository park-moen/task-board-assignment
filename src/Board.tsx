import type { Status } from './types';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { taskQueries } from './api/queries';
import { Column } from './components/Column';

const COLUMNS: { status: Status; title: string }[] = [
  { status: 'todo', title: 'To Do' },
  { status: 'in-progress', title: 'In Progress' },
  { status: 'done', title: 'Done' },
];

export default function Board() {
  const queryClient = useQueryClient();
  const { data: tasks, isLoading, isError, error, refetch } = useQuery(taskQueries.list());

  // ⚠️ 화면(캐시)만 바꾸는 "순진한" 이동입니다. 서버에 저장하지 않습니다.
  // TODO(#7): 낙관적 업데이트 + 실패 시 롤백 + 경쟁 상태 처리로 교체 예정
  const moveTask = (id: string, status: Status) => {
    queryClient.setQueryData(taskQueries.list().queryKey, prev =>
      prev?.map(t => (t.id === id ? { ...t, status } : t)));
  };

  const byStatus = useMemo(() => {
    const map: Record<Status, NonNullable<typeof tasks>> = { 'todo': [], 'in-progress': [], 'done': [] };
    for (const t of tasks ?? []) map[t.status].push(t);
    return map;
  }, [tasks]);

  if (isLoading) {
    return <p className="hint">불러오는 중…</p>;
  }

  if (isError) {
    return (
      <div className="hint error-state">
        <p>
          태스크를 불러오지 못했습니다.
          {error instanceof Error ? ` (${error.message})` : ''}
        </p>
        <button type="button" className="retry-button" onClick={() => refetch()}>
          재시도
        </button>
      </div>
    );
  }

  if (!tasks || tasks.length === 0) {
    return <p className="hint empty-state">표시할 태스크가 없습니다.</p>;
  }

  return (
    <div className="board">
      {COLUMNS.map(col => (
        <Column
          key={col.status}
          title={col.title}
          status={col.status}
          tasks={byStatus[col.status]}
          onMove={moveTask}
        />
      ))}
    </div>
  );
}
