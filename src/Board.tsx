import type { Status } from './types';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useMoveTask } from './api/mutations';
import { taskQueries } from './api/queries';
import { Column } from './components/Column';

const COLUMNS: { status: Status; title: string }[] = [
  { status: 'todo', title: 'To Do' },
  { status: 'in-progress', title: 'In Progress' },
  { status: 'done', title: 'Done' },
];

export default function Board() {
  const { data: tasks, isLoading, isError, error, refetch } = useQuery(taskQueries.list());
  const { mutate: moveTask } = useMoveTask();

  const handleMove = (id: string, status: Status) => {
    const task = tasks?.find(task => task.id === id);

    /**  같은 컬럼 안에서 드롭한 경우(status 변화 없음)는 요청을 보내지 않음 */
    if (!task || task.status === status) {
      return;
    }

    moveTask({ id, status });
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
          onMove={handleMove}
        />
      ))}
    </div>
  );
}
