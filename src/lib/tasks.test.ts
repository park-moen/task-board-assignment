import type { Task } from '../types';
import { describe, expect, it } from 'vitest';
import { filterByTitle, moveTask } from './tasks';

function make(id: string, over: Partial<Task> = {}): Task {
  return {
    id,
    title: `Task ${id}`,
    status: 'todo',
    priority: 'medium',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    version: 1,
    ...over,
  };
}

describe('moveTask', () => {
  it('대상 태스크의 status 만 바꾸고 나머지는 그대로 둔다', () => {
    const tasks = [make('a'), make('b')];
    const next = moveTask(tasks, 'a', 'done');
    expect(next.find(t => t.id === 'a')?.status).toBe('done');
    expect(next.find(t => t.id === 'b')?.status).toBe('todo');
  });

  it('불변성을 지킨다 (원본 배열/객체를 변경하지 않는다)', () => {
    const tasks = [make('a')];
    const next = moveTask(tasks, 'a', 'done');
    expect(tasks[0].status).toBe('todo');
    expect(next).not.toBe(tasks);
  });
});

describe('filterByTitle', () => {
  it('대소문자 구분 없이 제목으로 필터링한다', () => {
    const tasks = [make('a', { title: 'Fix login bug' }), make('b', { title: 'Write docs' })];
    expect(filterByTitle(tasks, 'FIX')).toHaveLength(1);
  });

  it('빈 검색어면 전체를 반환한다', () => {
    const tasks = [make('a'), make('b')];
    expect(filterByTitle(tasks, '   ')).toHaveLength(2);
  });

  it('매칭되는 태스크가 없으면 빈 배열을 반환한다', () => {
    const tasks = [make('a', { title: 'Fix login bug' }), make('b', { title: 'Write docs' })];
    expect(filterByTitle(tasks, 'nonexistent')).toEqual([]);
  });

  it('제목 중간에 있는 부분 문자열도 매칭한다', () => {
    const tasks = [make('a', { title: 'Fix login bug' }), make('b', { title: 'Write docs' })];
    expect(filterByTitle(tasks, 'login')).toHaveLength(1);
  });

  it('검색어 앞뒤 공백은 무시하고 매칭한다', () => {
    const tasks = [make('a', { title: 'Fix login bug' }), make('b', { title: 'Write docs' })];
    expect(filterByTitle(tasks, '  fix  ')).toHaveLength(1);
  });
});
