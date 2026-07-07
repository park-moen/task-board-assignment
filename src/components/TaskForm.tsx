import type { Priority } from '../types';
import { useId, useState } from 'react';

export interface TaskFormValues {
  title: string;
  priority: Priority;
  description?: string;
}

interface Props {
  initialValues?: TaskFormValues;
  submitLabel: string;
  onSubmit: (values: TaskFormValues) => void;
  onCancel: () => void;
}

const PRIORITY_OPTIONS: { value: Priority; label: string }[] = [
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
];

/** 생성/수정 화면 공용 폼 — initialValues 유무로 두 모드를 구분한다. */
export function TaskForm({ initialValues, submitLabel, onSubmit, onCancel }: Props) {
  const [title, setTitle] = useState(initialValues?.title ?? '');
  const [priority, setPriority] = useState<Priority>(initialValues?.priority ?? 'medium');
  const [description, setDescription] = useState(initialValues?.description ?? '');
  const [titleTouched, setTitleTouched] = useState(false);
  const titleId = useId();
  const titleErrorId = useId();
  const priorityId = useId();
  const descriptionId = useId();

  const trimmedTitle = title.trim();
  const showTitleError = titleTouched && !trimmedTitle;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!trimmedTitle) {
      setTitleTouched(true);
      return;
    }
    onSubmit({
      title: trimmedTitle,
      priority,
      description: description.trim() || undefined,
    });
  };

  return (
    <form className="task-form" onSubmit={handleSubmit}>
      <div className="form-field">
        <label htmlFor={titleId}>제목</label>
        <input
          id={titleId}
          type="text"
          value={title}
          onChange={e => setTitle(e.target.value)}
          aria-invalid={showTitleError}
          aria-describedby={titleErrorId}
          required
        />
        <p id={titleErrorId} className="field-error" role={showTitleError ? 'alert' : undefined}>
          {showTitleError ? '제목을 입력해주세요 (공백만으로는 저장할 수 없습니다)' : ''}
        </p>
      </div>

      <div className="form-field">
        <label htmlFor={priorityId}>우선순위</label>
        <select
          id={priorityId}
          value={priority}
          onChange={e => setPriority(e.target.value as Priority)}
          required
        >
          {PRIORITY_OPTIONS.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>

      <div className="form-field">
        <label htmlFor={descriptionId}>
          설명
          {' '}
          <span className="optional-label">(선택)</span>
        </label>
        <textarea
          id={descriptionId}
          value={description}
          onChange={e => setDescription(e.target.value)}
          rows={3}
        />
      </div>

      <div className="form-actions">
        <button type="button" className="btn" onClick={onCancel}>취소</button>
        <button type="submit" className="btn btn-primary">{submitLabel}</button>
      </div>
    </form>
  );
}
