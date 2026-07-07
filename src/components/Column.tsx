import type { Status, Task } from '../types';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useCallback, useRef } from 'react';
import { Card } from './Card';

interface Props {
  title: string;
  status: Status;
  tasks: Task[];
  onMove: (id: string, status: Status) => void;
  onEdit: (task: Task) => void;
  onDelete: (task: Task) => void;
}

// 실측(measureElement) 전까지 쓰는 초기 추정치일 뿐, 실제 카드 높이를 강제하지 않음
const ESTIMATED_CARD_HEIGHT = 76;

export function Column({ title, status, tasks, onMove, onEdit, onDelete }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  // 의존성이 없는 고정값이므로 useCallback으로 참조를 고정해, 매 렌더마다 옵션이
  // "바뀐 것으로" 오인되어 위치 재계산(incremental 최적화 무력화)이 일어나지 않게 한다
  const estimateSize = useCallback(() => ESTIMATED_CARD_HEIGHT, []);

  const virtualizer = useVirtualizer({
    count: tasks.length,
    getScrollElement: () => scrollRef.current,
    estimateSize,
    // 화면 밖으로 몇 개의 카드를 여분으로 더 렌더할지 (스크롤 시 빈 공간 깜빡임 방지용 버퍼)
    // 실제 렌더 결과 기준 위치 재계산은 measureElement(아래)가 담당
    overscan: 5,
    // 기본값(인덱스)으로 캐싱하면 카드가 자리를 옮길 때 엉뚱한 카드의 측정값을 재사용하게 됨
    getItemKey: index => tasks[index].id,
  });

  return (
    <section
      className="column"
      onDragOver={e => e.preventDefault()}
      onDrop={(e) => {
        const id = e.dataTransfer.getData('text/plain');
        if (id)
          onMove(id, status);
      }}
    >
      <h2 className="column-title">
        {title}
        {' '}
        <span className="count">{tasks.length}</span>
      </h2>
      <div ref={scrollRef} className="column-body">
        <div className="column-body-inner" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((virtualItem) => {
            const task = tasks[virtualItem.index];
            return (
              <div
                key={task.id}
                ref={virtualizer.measureElement}
                data-index={virtualItem.index}
                className="card-row"
                style={{ transform: `translateY(${virtualItem.start}px)` }}
              >
                <Card task={task} onEdit={onEdit} onDelete={onDelete} />
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
