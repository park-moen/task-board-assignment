import type { Status, Task } from '../types';

/**
 * 순수 함수 예시 — 이런 로직을 테스트로 검증하세요. (tasks.test.ts 참고)
 * 필요하면 자유롭게 수정/삭제해도 됩니다.
 */
export function moveTask(tasks: Task[], id: string, status: Status): Task[] {
  return tasks.map(t => (t.id === id ? { ...t, status } : t));
}

export function filterByTitle(tasks: Task[], query: string): Task[] {
  const q = query.trim().toLowerCase();
  if (!q)
    return tasks;
  return tasks.filter(t => t.title.toLowerCase().includes(q));
}

export function addTask(tasks: Task[], task: Task): Task[] {
  return [task, ...tasks];
}

export function insertTaskAt(tasks: Task[], index: number, task: Task): Task[] {
  const at = Math.min(Math.max(index, 0), tasks.length);
  return [...tasks.slice(0, at), task, ...tasks.slice(at)];
}

export function removeTask(tasks: Task[], id: string): Task[] {
  return tasks.filter(t => t.id !== id);
}

export function updateTaskFields(tasks: Task[], id: string, patch: Partial<Task>): Task[] {
  return tasks.map(t => (t.id === id ? { ...t, ...patch } : t));
}
