import type { Task } from '../types';

const PRIORITY_LABEL: Record<Task['priority'], string> = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

interface Props {
  task: Task;
  onEdit: (task: Task) => void;
  onDelete: (task: Task) => void;
}

export function Card({ task, onEdit, onDelete }: Props) {
  return (
    <article
      className={`card priority-${task.priority}`}
      draggable
      onDragStart={e => e.dataTransfer.setData('text/plain', task.id)}
      onClick={() => onEdit(task)}
    >
      <div className="card-title">{task.title}</div>
      <div className="card-meta">
        <span className={`badge badge-${task.priority}`}>{PRIORITY_LABEL[task.priority]}</span>
        <span className="date">{new Date(task.createdAt).toLocaleDateString()}</span>
        <button
          type="button"
          className="card-delete"
          aria-label={`${task.title} 삭제`}
          onClick={(e) => {
            // 카드 클릭(수정 열기)으로 이벤트가 번지는 것을 막음
            e.stopPropagation();
            onDelete(task);
          }}
        >
          &times;
        </button>
      </div>
    </article>
  );
}
