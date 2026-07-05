import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      /**
       * moveTask()가 아직 서버에 저장하지 않고 캐시만 바꾸는 임시 구현이라(TODO #7),
       * 창 포커스 복귀 시 refetch가 걸리면 이동한 카드가 원래 자리로 되돌아가 보입니다.
       * #7에서 낙관적 업데이트 + 서버 반영이 끝나면 이 옵션은 제거해도 됩니다.
       */
      refetchOnWindowFocus: false,
    },
  },
});
