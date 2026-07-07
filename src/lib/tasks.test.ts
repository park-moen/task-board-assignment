import type { Task } from '../types';
import { describe, expect, it } from 'vitest';
import { addTask, filterByTitle, insertTaskAt, moveTask, removeTask, updateTaskFields } from './tasks';

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

  it('존재하지 않는 id면 아무것도 바꾸지 않는다', () => {
    const tasks = [make('a'), make('b')];
    const next = moveTask(tasks, 'nonexistent', 'done');
    expect(next.every(t => t.status === 'todo')).toBe(true);
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

describe('addTask', () => {
  it('새 태스크를 목록 맨 앞에 추가한다', () => {
    const tasks = [make('a')];
    const next = addTask(tasks, make('b'));
    expect(next).toHaveLength(2);
    expect(next[0].id).toBe('b');
  });

  it('불변성을 지킨다 (원본 배열을 변경하지 않는다)', () => {
    const tasks = [make('a')];
    const next = addTask(tasks, make('b'));
    expect(tasks).toHaveLength(1);
    expect(next).not.toBe(tasks);
  });
});

describe('insertTaskAt', () => {
  it('지정한 인덱스에 태스크를 끼워 넣는다', () => {
    const tasks = [make('a'), make('b'), make('c')];
    const next = insertTaskAt(tasks, 1, make('x'));
    expect(next.map(t => t.id)).toEqual(['a', 'x', 'b', 'c']);
  });

  it('인덱스가 범위를 벗어나면 가장 가까운 끝으로 클램핑한다', () => {
    const tasks = [make('a'), make('b')];
    expect(insertTaskAt(tasks, -1, make('x')).map(t => t.id)).toEqual(['x', 'a', 'b']);
    expect(insertTaskAt(tasks, 99, make('x')).map(t => t.id)).toEqual(['a', 'b', 'x']);
  });

  it('불변성을 지킨다 (원본 배열을 변경하지 않는다)', () => {
    const tasks = [make('a'), make('b')];
    const next = insertTaskAt(tasks, 1, make('x'));
    expect(tasks).toHaveLength(2);
    expect(next).not.toBe(tasks);
  });
});

describe('removeTask', () => {
  it('대상 id의 태스크만 제거하고 나머지는 그대로 둔다', () => {
    const tasks = [make('a'), make('b')];
    const next = removeTask(tasks, 'a');
    expect(next).toHaveLength(1);
    expect(next[0].id).toBe('b');
  });

  it('존재하지 않는 id면 원본과 동일한 내용을 반환한다', () => {
    const tasks = [make('a'), make('b')];
    const next = removeTask(tasks, 'nonexistent');
    expect(next).toHaveLength(2);
  });

  it('불변성을 지킨다 (원본 배열을 변경하지 않는다)', () => {
    const tasks = [make('a'), make('b')];
    const next = removeTask(tasks, 'a');
    expect(tasks).toHaveLength(2);
    expect(next).not.toBe(tasks);
  });
});

describe('updateTaskFields', () => {
  it('대상 태스크의 지정된 필드만 바꾸고 나머지는 그대로 둔다', () => {
    const tasks = [make('a', { title: 'Old title', priority: 'low' }), make('b')];
    const next = updateTaskFields(tasks, 'a', { title: 'New title' });
    expect(next.find(t => t.id === 'a')).toMatchObject({ title: 'New title', priority: 'low' });
    expect(next.find(t => t.id === 'b')?.title).toBe('Task b');
  });

  it('불변성을 지킨다 (원본 배열/객체를 변경하지 않는다)', () => {
    const tasks = [make('a', { title: 'Old title' })];
    const next = updateTaskFields(tasks, 'a', { title: 'New title' });
    expect(tasks[0].title).toBe('Old title');
    expect(next).not.toBe(tasks);
  });

  it('존재하지 않는 id면 아무것도 바꾸지 않는다', () => {
    const tasks = [make('a', { title: 'Old title' })];
    const next = updateTaskFields(tasks, 'nonexistent', { title: 'New title' });
    expect(next[0].title).toBe('Old title');
  });

  it('description을 undefined로 명시하면 기존 값을 지운다', () => {
    const tasks = [make('a', { description: '기존 설명' })];
    const next = updateTaskFields(tasks, 'a', { description: undefined });
    expect(next[0].description).toBeUndefined();
  });
});
