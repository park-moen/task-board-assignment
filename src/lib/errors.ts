import { ApiError } from '../api/client';

export type MutationErrorKind = 'conflict' | 'network' | 'server' | 'aborted';

/**
 * 서버 응답을 받지 못한 fetch 레벨 실패는 'network'로 분류한다.
 * 서버 응답이 있는 ApiError 중 409는 버전 충돌로 별도 분류한다.
 * AbortController에 의한 의도적 취소는 'aborted'로 분류해 network 실패와 구분한다.
 */
export function classifyMutationError(error: unknown): MutationErrorKind {
  if (error instanceof ApiError) {
    return error.status === 409 ? 'conflict' : 'server';
  }

  if (error instanceof DOMException && error.name === 'AbortError') {
    return 'aborted';
  }

  return 'network';
}
