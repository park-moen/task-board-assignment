import { queryOptions } from '@tanstack/react-query';
import { getTasks } from './client';

/** Query Key Factory 패턴: queryKey/queryFn을 함께 관리해 캐시 무효화 시 타입 안정성을 확보 */
export const taskQueries = {
  all: () => ['tasks'] as const,
  lists: () => [...taskQueries.all(), 'list'] as const,
  list: () =>
    queryOptions({
      queryKey: taskQueries.lists(),
      queryFn: ({ signal }) => getTasks(signal),
    }),
};
