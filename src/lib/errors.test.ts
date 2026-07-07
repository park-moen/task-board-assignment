import type { Task } from '../types';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../api/client';
import { classifyMutationError, getConflictServerTask, toFailureToastMessage } from './errors';

describe('classifyMutationError', () => {
  it('서버 응답을 나타내는 ApiError의 status가 409면 conflict로 분류한다', () => {
    const error = new ApiError(409, '충돌', { current: {} });
    expect(classifyMutationError(error)).toBe('conflict');
  });

  it('서버 응답을 나타내는 ApiError의 status가 409가 아니면 server로 분류한다', () => {
    const error = new ApiError(500, '서버 오류', null);
    expect(classifyMutationError(error)).toBe('server');
  });

  it('fetch 자체가 실패해 ApiError가 아니면 network로 분류한다', () => {
    const error = new TypeError('Failed to fetch');
    expect(classifyMutationError(error)).toBe('network');
  });

  it('일반적인 Error가 아닌 값이 와도 network로 분류한다', () => {
    expect(classifyMutationError('unexpected')).toBe('network');
    expect(classifyMutationError(null)).toBe('network');
  });

  it('abortController에 의한 의도적 취소는 aborted로 분류한다', () => {
    const error = new DOMException('The operation was aborted', 'AbortError');
    expect(classifyMutationError(error)).toBe('aborted');
  });
});

describe('getConflictServerTask', () => {
  it('409 응답의 payload에서 서버 최신 태스크를 반환한다', () => {
    const serverTask = { id: 'a', title: 'Server title' } as Task;
    const error = new ApiError(409, '충돌', { current: serverTask });
    expect(getConflictServerTask(error)).toBe(serverTask);
  });

  it('409가 아니면 undefined를 반환한다', () => {
    const error = new ApiError(500, '서버 오류', { current: {} });
    expect(getConflictServerTask(error)).toBeUndefined();
  });

  it('일반적인 fetch 실패라 ApiError가 아니면 undefined를 반환한다', () => {
    expect(getConflictServerTask(new TypeError('Failed to fetch'))).toBeUndefined();
  });
});

describe('toFailureToastMessage', () => {
  it('네트워크 단절이면 공통 안내 문구를 반환한다', () => {
    expect(toFailureToastMessage(new TypeError('Failed to fetch'), '이동에 실패했습니다.'))
      .toBe('네트워크 연결을 확인해주세요.');
  });

  it('서버 응답을 나타내는 ApiError(404 등)면 호출부의 기본 메시지를 반환한다', () => {
    const notFound = new ApiError(404, '카드를 찾을 수 없습니다.', null);
    expect(toFailureToastMessage(notFound, '이동에 실패했습니다.')).toBe('이동에 실패했습니다.');
  });

  it('409 충돌은 호출부에서 별도 처리하므로 기본 메시지를 반환한다', () => {
    const conflict = new ApiError(409, '충돌', { current: {} });
    expect(toFailureToastMessage(conflict, '수정에 실패했습니다.')).toBe('수정에 실패했습니다.');
  });
});
