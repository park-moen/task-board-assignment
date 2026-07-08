# Task Board - 비동기 견고성 과제 제출

느리고 가끔 실패하는 mock API 위에서 동작하는 칸반 태스크 보드입니다. TanStack Query 기반 낙관적 업데이트/롤백, 경쟁 상태 처리, 409 충돌 처리, 5,000개 태스크 가상화, CRUD, 검색/디바운싱을 중심으로 구현했습니다.

- **배포 URL**: https://park-moen.github.io/task-board-assignment/
- **설계 근거**: [DECISIONS.md](./DECISIONS.md)
- **AI 활용 내역**: [AI_USAGE.md](./AI_USAGE.md)

## 실행 방법

```bash
npm install    # postinstall에서 public/mockServiceWorker.js 자동 생성
npm run dev    # 개발 서버 (http://localhost:5173)
npm test       # 유닛 테스트 (Vitest)
npm run build  # 타입체크 + 프로덕션 빌드
```

Node 18 이상을 권장합니다.

개발 중 실패를 강제로 재현하려면 `src/mocks/config.ts`의 `WRITE_FAILURE_RATE`를 `1`로 올리면 모든 쓰기 요청이 실패합니다(롤백 검증용). 제출 전 기본값은 `0.15`입니다.

## 구현 기능

### Priority 1 - 구현 완료

| 기능 | 위치 | 비고 |
|---|---|---|
| 로딩 / 에러(재시도) / 빈 상태 분기 | `src/Board.tsx` | 최초 로드 실패 시 에러 화면과 재시도 버튼을 보여주고, 태스크 0개와 검색 결과 없음 상태를 구분 |
| 낙관적 업데이트와 실패 롤백 | `src/api/mutations.ts`, `src/lib/tasks.ts` | 이동/생성/수정/삭제를 `onMutate`에서 먼저 캐시에 반영하고, 실패 시 `onError`에서 스냅샷으로 복원 |
| 경쟁 상태 처리 | `src/api/mutations.ts` | 같은 태스크 요청은 `scope`로 직렬화하고, 실행 시점의 최신 `version`을 사용해 오래된 응답이 최신 상태를 덮어쓰지 않도록 처리 |
| 대량 데이터 성능(5,000개) | `src/components/Column.tsx` | `@tanstack/react-virtual`로 뷰포트와 `overscan` 범위의 카드만 렌더링 |
| 태스크 관리(CRUD) | `src/components/TaskForm.tsx`, `src/components/Modal.tsx`, `src/components/ConfirmDialog.tsx` | 생성/수정 공용 폼과 삭제 확인 다이얼로그 구현 |
| 검색 | `src/Board.tsx`, `src/components/Input.tsx`, `src/lib/tasks.ts`, `src/hooks/useDebouncedValue.ts` | 제목 기준 검색, 가상화와 함께 적용, 300ms 디바운스 |
| 핵심 로직 유닛 테스트 | `src/lib/tasks.test.ts`, `src/lib/errors.test.ts`, `src/hooks/useDebouncedValue.test.ts`, `src/api/mutations.test.tsx` | 필터링, 태스크 조작 순수 함수, 에러 분류, 디바운스 훅, 낙관적 업데이트/롤백/409 처리 검증 |

### Priority 2 - 구현 또는 정책 정리

| 기능 | 상태 | 비고 |
|---|---|---|
| 409 충돌 처리 UX | 구현 | 서버가 응답에 담아 준 최신 상태(`payload.current`)를 조건부로 반영하고 별도 Toast 표시 |
| 검색 디바운싱 | 구현 | 검색창 표시값은 즉시 반영하고, 실제 필터링과 컬럼별 그룹 계산에만 300ms 지연 적용 |
| 실패한 요청의 재시도 / 백오프 | 정책 정리 | 자동 재시도/재시도 UI는 제외하고 실패 상태 정리와 원인 안내까지만 처리 |
| 다중 탭 동기화 | 미구현 | mock 서버가 탭별 독립 메모리라 실시간 동기화에 추가 구현 필요 (DECISIONS.md 6번) |
| 키보드 접근성(카드 이동, ARIA, 포커스 관리) | 미구현 | 시간 제약상 범위 밖 |
| 우선순위·상태·태그 다중 필터 | 미구현 | 제목 검색만 구현 |

재시도 정책과 미구현 사유는 [DECISIONS.md](./DECISIONS.md)의 5번, 6번에 정리했습니다.

## 기술 스택

- React 18 + TypeScript(strict) + Vite
- TanStack Query: 서버 상태, 캐싱, 낙관적 업데이트, 뮤테이션 생명주기 관리
- `@tanstack/react-virtual`: 5,000개 태스크 목록 가상화
- Vitest + Testing Library: 핵심 로직과 hook/mutation 테스트
- MSW: 브라우저에서 동작하는 mock API

상태 관리 라이브러리(Redux, Zustand 등)는 도입하지 않았습니다. 서버 상태는 TanStack Query에 두고, 검색어·모달 같은 UI 상태는 컴포넌트 state로, Toast는 Context로 관리합니다. 선택 근거는 [DECISIONS.md](./DECISIONS.md)에 정리했습니다.

## 코드 구조

- `src/api/`: API 클라이언트, TanStack Query query/mutation hook
- `src/components/`: 보드 UI, 카드, 컬럼, 모달, 폼, 확인 다이얼로그
- `src/contexts/`: Toast 표시를 위한 Context
- `src/hooks/`: 검색 디바운싱 hook
- `src/lib/`: 태스크 조작 순수 함수, 에러 분류 유틸, QueryClient 설정
- `src/mocks/`: MSW handler, mock DB, 시드 데이터, 실패율 설정

## mock API

모든 요청에는 200~800ms의 랜덤 지연이 있으며, 실패율은 `src/mocks/config.ts`에서 조절할 수 있습니다.

| Method | Endpoint | 설명 | 실패 조건 |
|---|---|---|---|
| GET | `/api/tasks` | 전체 태스크(5,000개)를 한 번에 반환 | 드물게 500 |
| POST | `/api/tasks` | 태스크 생성 | 약 15% 확률로 500 |
| PATCH | `/api/tasks/:id` | 태스크 부분 수정 | 약 15% 확률로 500, `version` 불일치 시 409 |
| DELETE | `/api/tasks/:id` | 태스크 삭제 | 약 15% 확률로 500 |

- **낙관적 동시성 제어**: 각 태스크에는 `version`이 있습니다. `PATCH` 요청은 현재 알고 있는 `version`을 함께 보내야 하며, 서버 값과 다르면 409와 함께 서버 최신 상태를 반환합니다. 409 응답의 서버 최신 상태는 `ApiError.payload.current`로 읽을 수 있습니다.
- **데이터 유지**: mock 서버는 내부적으로 localStorage를 사용하므로, API를 통해 변경한 데이터는 새로고침 후에도 유지됩니다. 초기 시드로 되돌리려면 브라우저 콘솔에서 `resetMockDb()`를 호출하면 됩니다.

## GitHub Pages 배포

`main` 브랜치에 push되면 `.github/workflows/deploy.yml`이 `VITE_BASE="/${GITHUB_REPOSITORY#*/}/" npm run build`를 실행한 뒤 GitHub Pages에 배포합니다.

로컬에서 같은 base 경로로 빌드하려면 다음 명령을 사용할 수 있습니다.

```bash
VITE_BASE=/task-board-assignment/ npm run build
```

Windows Git Bash에서는 앞 슬래시가 경로로 변환될 수 있으므로 PowerShell에서 실행하는 것을 권장합니다.

```powershell
$env:VITE_BASE="/task-board-assignment/"; npm run build
```
