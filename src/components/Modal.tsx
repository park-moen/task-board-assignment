import { useEffect, useRef } from 'react';

interface Props {
  open: boolean;
  onClose: () => void;
  titleId: string;
  children: React.ReactNode;
}

/**
 * 네이티브 <dialog>를 씁니다 — showModal()이 포커스 트랩, Escape 닫기,
 * ::backdrop을 브라우저가 기본 제공해 별도 a11y 구현이 필요 없습니다.
 */
export function Modal({ open, onClose, titleId, children }: Props) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog)
      return;
    if (open && !dialog.open)
      dialog.showModal();
    else if (!open && dialog.open)
      dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="modal"
      aria-labelledby={titleId}
      onClose={onClose}
      onCancel={onClose}
      onClick={(e) => {
        // backdrop(다이얼로그 자기 자신) 클릭 시 닫기 — 내부 콘텐츠 클릭은 버블링으로 걸러짐
        if (e.target === ref.current)
          onClose();
      }}
    >
      {open && children}
    </dialog>
  );
}
