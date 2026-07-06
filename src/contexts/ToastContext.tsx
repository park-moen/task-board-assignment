import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

type ToastType = 'success' | 'error' | 'info';

interface Toast {
  id: string;
  message: string;
  type: ToastType;
}

interface ToastDispatch {
  addToast: (message: string, type?: ToastType) => void;
  removeToast: (id: string) => void;
}

const DEFAULT_TOAST_DURATION_MS = 3000;

/**
 * addToast/removeToast 참조가 아니라 toasts 배열이 바뀔 때만 구독자가 리렌더되도록
 * 상태(State)와 디스패치(Dispatch)를 별도 Context로 분리한다.
 */
const ToastStateContext = createContext<Toast[]>([]);
const ToastDispatchContext = createContext<ToastDispatch | null>(null);

interface ToastProviderProps {
  children: React.ReactNode;
  /** 모든 토스트에 적용되는 자동 닫힘 시간(ms). 토스트별 개별 설정은 아직 지원하지 않음. */
  duration?: number;
}

export function ToastProvider({ children, duration = DEFAULT_TOAST_DURATION_MS }: ToastProviderProps) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  /**
   * toast id별 자동 닫힘 setTimeout 핸들을 보관한다.
   * 클릭으로 수동 닫힘(removeToast) 시 아직 남아있는 타이머를 clearTimeout으로 정리해야
   * 이미 제거된 id로 뒤늦게 removeToast가 다시 호출되는 것을 막을 수 있다.
   */
  const timeoutsRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const removeToast = useCallback((id: string) => {
    const timeoutId = timeoutsRef.current.get(id);
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
      timeoutsRef.current.delete(id);
    }
    setToasts(prev => prev.filter(toast => toast.id !== id));
  }, []);

  const addToast = useCallback((message: string, type: ToastType = 'info') => {
    const id = crypto.randomUUID();
    setToasts(prev => [...prev, { id, message, type }]);
    /** setTimeout(fn, delay, ...args) 형태로 id를 직접 전달 — 클로저 재생성 없이 최신 removeToast 참조 사용 */
    const timeoutId = setTimeout(removeToast, duration, id);
    timeoutsRef.current.set(id, timeoutId);
  }, [removeToast, duration]);

  /** ToastProvider가 언마운트될 때 아직 발화하지 않은 타이머를 모두 정리해 메모리 누수를 방지한다. */
  useEffect(() => {
    const timeouts = timeoutsRef.current;
    return () => {
      timeouts.forEach(timeoutId => clearTimeout(timeoutId));
      timeouts.clear();
    };
  }, []);

  const dispatch = useMemo(() => ({ addToast, removeToast }), [addToast, removeToast]);

  return (
    <ToastDispatchContext.Provider value={dispatch}>
      <ToastStateContext.Provider value={toasts}>
        {children}
      </ToastStateContext.Provider>
    </ToastDispatchContext.Provider>
  );
}

/**  custom hook — Context를 직접 노출하지 않고 계약(에러 메시지)을 강제 */
export function useToast() {
  const context = useContext(ToastDispatchContext);

  if (!context) {
    throw new Error('useToast는 ToastProvider 내부에서만 사용할 수 있습니다.');
  }

  return context;
}

/**  실제 렌더링 담당 - ToastStateContext만 구독하므로 리렌더 범위가 이 컴포넌트로 한정됨 */
export function ToastContainer() {
  const toasts = useContext(ToastStateContext);
  const { removeToast } = useToast();

  return (
    <div className="toast-container">
      {toasts.map(toast => (
        <div key={toast.id} className={`toast toast-${toast.type}`} onClick={() => removeToast(toast.id)}>
          {toast.message}
        </div>
      ))}
    </div>
  );
}
