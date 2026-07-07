import type { Task } from '../types';
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

/** 409 충돌이면 서버가 반환한 최신 태스크를 반환하고, 아니면 undefined를 반환한다. */
export function getConflictServerTask(error: unknown): Task | undefined {
  if (!(error instanceof ApiError) || error.status !== 409) {
    return undefined;
  }

  return (error.payload as { current?: Task } | null)?.current;
}

/** 네트워크 오류는 공통 안내 문구로 변환하고, 그 외 오류는 호출부의 기본 메시지를 유지한다. */
export function toFailureToastMessage(error: unknown, defaultMessage: string): string {
  return classifyMutationError(error) === 'network' ? '네트워크 연결을 확인해주세요.' : defaultMessage;
}
