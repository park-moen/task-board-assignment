import { useId } from 'react';
import { Modal } from './Modal';

interface Props {
  open: boolean;
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/** 삭제 등 되돌리기 어려운 작업 전에 재확인하는 범용 다이얼로그. */
export function ConfirmDialog({ open, message, confirmLabel = '확인', onConfirm, onCancel }: Props) {
  const titleId = useId();

  return (
    <Modal open={open} onClose={onCancel} titleId={titleId}>
      <p id={titleId} className="confirm-message">{message}</p>
      <div className="form-actions">
        <button type="button" className="btn" onClick={onCancel}>취소</button>
        <button type="button" className="btn btn-danger" onClick={onConfirm}>{confirmLabel}</button>
      </div>
    </Modal>
  );
}
