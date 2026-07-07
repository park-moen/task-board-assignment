import type { Status, Task } from './types';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useCreateTask, useDeleteTask, useMoveTask, useUpdateTask } from './api/mutations';
import { taskQueries } from './api/queries';
import { Column } from './components/Column';
import { ConfirmDialog } from './components/ConfirmDialog';
import { Input } from './components/Input';
import { Modal } from './components/Modal';
import { TaskForm } from './components/TaskForm';
import { filterByTitle } from './lib/tasks';

const COLUMNS: { status: Status; title: string }[] = [
  { status: 'todo', title: 'To Do' },
  { status: 'in-progress', title: 'In Progress' },
  { status: 'done', title: 'Done' },
];

type FormState = { mode: 'create' } | { mode: 'edit'; task: Task } | null;

export default function Board() {
  const { data: tasks, isLoading, isError, error, refetch } = useQuery(taskQueries.list());
  const { mutate: moveTask } = useMoveTask();
  const { mutate: createTask } = useCreateTask();
  const { mutate: updateTask } = useUpdateTask();
  const { mutate: deleteTask } = useDeleteTask();
  const [query, setQuery] = useState('');
  const [formState, setFormState] = useState<FormState>(null);
  const [deletingTask, setDeletingTask] = useState<Task | null>(null);

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
    for (const t of filterByTitle(tasks ?? [], query)) map[t.status].push(t);
    return map;
  }, [tasks, query]);

  const formTitleId = 'task-form-title';

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

  const hasResults = Object.values(byStatus).some(list => list.length > 0);
  const hasAnyTask = !!tasks && tasks.length > 0;

  return (
    <>
      <div className="board-toolbar">
        <Input value={query} onChange={setQuery} label="태스크 제목 검색" placeholder="제목으로 검색" />
        <button type="button" className="btn btn-primary" onClick={() => setFormState({ mode: 'create' })}>
          + 새 태스크
        </button>
      </div>

      {!hasAnyTask && <p className="hint empty-state">표시할 태스크가 없습니다.</p>}

      {hasAnyTask && (
        hasResults
          ? (
              <div className="board">
                {COLUMNS.map(col => (
                  <Column
                    key={col.status}
                    title={col.title}
                    status={col.status}
                    tasks={byStatus[col.status]}
                    onMove={handleMove}
                    onEdit={task => setFormState({ mode: 'edit', task })}
                    onDelete={task => setDeletingTask(task)}
                  />
                ))}
              </div>
            )
          : <p className="hint empty-state">검색 결과가 없습니다.</p>
      )}

      <Modal open={formState !== null} onClose={() => setFormState(null)} titleId={formTitleId}>
        <h2 id={formTitleId}>{formState?.mode === 'edit' ? '태스크 수정' : '새 태스크'}</h2>
        <TaskForm
          key={formState?.mode === 'edit' ? formState.task.id : 'create'}
          initialValues={formState?.mode === 'edit' ? formState.task : undefined}
          submitLabel={formState?.mode === 'edit' ? '수정' : '추가'}
          onCancel={() => setFormState(null)}
          onSubmit={(values) => {
            if (formState?.mode === 'edit')
              updateTask({ id: formState.task.id, ...values });
            else
              createTask(values);
            setFormState(null);
          }}
        />
      </Modal>

      <ConfirmDialog
        open={deletingTask !== null}
        message={deletingTask ? `"${deletingTask.title}"을(를) 삭제할까요?` : ''}
        confirmLabel="삭제"
        onCancel={() => setDeletingTask(null)}
        onConfirm={() => {
          if (deletingTask)
            deleteTask(deletingTask.id);
          setDeletingTask(null);
        }}
      />
    </>
  );
}
