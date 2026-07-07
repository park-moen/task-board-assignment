import { describe, expect, it } from 'vitest';
import { ApiError } from '../api/client';
import { classifyMutationError } from './errors';

describe('classifyMutationError', () => {
  it('서버가 준 ApiError의 status가 409면 conflict로 분류한다', () => {
    const error = new ApiError(409, '충돌', { current: {} });
    expect(classifyMutationError(error)).toBe('conflict');
  });

  it('서버가 준 ApiError의 status가 409가 아니면 server로 분류한다', () => {
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
