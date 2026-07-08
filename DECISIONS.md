# 설계 결정 (DECISIONS)

> 이 문서는 평가에서 **20%**를 차지합니다. "무엇을 했는지"보다 **"왜 그렇게 했는지"**를 봅니다.
> 아래 항목을 채워 주세요. 코드로 답이 되는 부분은 파일 경로를 함께 적어도 좋습니다.

## 1. 상태 구조

**서버 상태**: 태스크 목록은 TanStack Query 캐시에서 서버 상태로 관리합니다. `src/api/queries.ts`는 `queryKey`와 `queryOptions()` 기반 조회 옵션을 정의하고 `src/api/mutations.ts`는 생성·수정·삭제·이동 뮤테이션에서 낙관적 업데이트와 롤백을 담당합니다.(자세한 동작은 2번 참고).

**태스크 배열 조작**: 태스크 배열의 기본 조작은 `src/lib/tasks.ts`의 순수 함수로 분리했습니다. `moveTask`/`filterByTitle`/`addTask`/`insertTaskAt`/`removeTask`/`updateTaskFields`가 배열 변형을 담당하고, `src/api/mutations.ts`는 이 함수들을 TanStack Query 캐시에 언제 반영하고 실패 시 어떻게 복구할지 조율합니다. 에러 분류도 `src/lib/errors.ts`로 분리해, 캐시·네트워크와 무관한 로직은 `src/lib/*.test.ts`에서 유닛 테스트할 수 있게 했습니다.

**로컬 UI 상태**: 검색어(`query`), 생성·수정 모달 상태(`formState`), 삭제 확인 대상(`deletingTask`)처럼 `Board` 안에서만 쓰는 값은 컴포넌트 로컬 state로 관리합니다. 검색 결과는 별도 상태로 저장하지 않고, `tasks`와 디바운스된 검색어(`debouncedQuery`)에서 `useMemo`로 계산합니다.

**전역 UI 상태**: Toast는 뮤테이션 실패처럼 여러 위치에서 띄워야 하므로 React Context API로 구현했습니다(`src/contexts/ToastContext.tsx`). 전역 상태 라이브러리는 도입하지 않았고, Toast 목록을 읽는 Context와 Toast를 추가·제거하는 함수를 제공하는 Context를 나눠 Toast 목록이 바뀔 때만 실제 Toast 렌더링 영역이 갱신되도록 했습니다.

**이렇게 잡은 이유**:
- 서버에서 온 데이터와 UI 상태는 관리 기준이 다릅니다. 서버 데이터와 동기화되어야 하는 태스크 목록은 TanStack Query에서 담당하고, 검색어·모달 상태처럼 화면 동작에만 필요한 값은 `Board`의 로컬 state로 제한했습니다.
- 태스크 배열을 조작하는 기본 연산을 순수 함수로 분리해, 낙관적 업데이트·실패 복구·검색 필터링에서 같은 함수를 재사용할 수 있게 했습니다. 다만 캐시에 언제 반영하고 실패 시 어떻게 복구할지는 TanStack Query의 mutation 생명주기 안에서 처리합니다.
- 컴포넌트 트리가 얕아(Board → Column → Card, 최대 2단계) Redux/Zustand를 도입하지 않아도 상태 전달 부담이 크지 않았습니다. 예외적으로 여러 위치에서 호출되는 Toast만 Context API로 분리했습니다.

**TanStack Query를 선택한 이유**:
- 이 프로젝트에서는 낙관적 업데이트와 롤백, 경쟁 상태 처리, GET 실패 재시도, 낙관적 업데이트 전에 진행 중인 refetch를 취소하는 처리가 필요했습니다. 이 요구사항을 구현하는 데 필요한 생명주기와 캐시 제어 기능을 TanStack Query가 제공한다고 판단했습니다. `onMutate`/`onError`/`onSuccess` 뮤테이션 생명주기로 스냅샷 저장과 롤백을 처리하고, `scope` 옵션으로 태스크별 요청을 직렬화하며, 조회 재시도(기본 3회)와 `queryFn`의 `signal`을 통한 `AbortSignal` 연동을 활용할 수 있었습니다. 이를 직접 구현하면 스냅샷 관리·재시도·요청 취소를 모두 직접 다뤄야 해 버그 위험이 커진다고 판단했습니다.
- **`SWR`과 비교**: SWR도 `optimisticData`와 `rollbackOnError`로 낙관적 업데이트와 실패 복구를 구현할 수 있습니다. 다만 이 프로젝트에서는 `onMutate`에서 스냅샷을 만들고, 같은 mutation의 `onError`/`onSuccess`로 넘겨 복구 범위를 제어하며, `scope`로 태스크별 요청을 직렬화하는 구조를 사용했습니다. 이 흐름은 TanStack Query의 mutation 생명주기와 더 직접적으로 맞아 TanStack Query를 선택했습니다.
- **`RTK Query`와 비교**: 기능은 유사하지만 Redux Toolkit 기반 API slice와 middleware 구성이 필요합니다. 위에서 "컴포넌트 트리가 얕아 Redux/Zustand 도입 실익이 낮다"고 판단했기 때문에, RTK Query를 위해 Redux 기반 구성을 추가하는 것은 현재 구조에 비해 무겁다고 판단했습니다.
- 부가적으로 TypeScript strict 모드와 타입 추론이 잘 맞고, React Query Devtools로 캐시·뮤테이션 상태를 개발 중 직접 관찰할 수 있어(`main.tsx`에 연결해 사용) 디버깅에 도움이 되었습니다.

## 2. 낙관적 업데이트 & 롤백

**현재 구현 범위**: 드래그 이동을 처리하는 `useMoveTask`와 동일한 방식으로, 생성·수정·삭제(`useCreateTask`/`useUpdateTask`/`useDeleteTask`, [Issue #11](https://github.com/park-moen/task-board-assignment/issues/11))도 mutation 생명주기(`onMutate`/`onError`, 필요한 경우 `onSuccess`)를 사용해 구현했습니다(`src/api/mutations.ts`). 삭제는 성공 시 이미 낙관적으로 제거된 캐시 상태를 그대로 유지하면 되어 `onSuccess`가 없습니다.

**이동(`useMoveTask`)의 동작 방식**:
1. `onMutate`에서 `queryClient.cancelQueries`로 진행 중인 refetch를 취소합니다. 이건 단순히 취소 요청을 보내는 게 아니라, `src/api/queries.ts`의 `queryFn: ({ signal }) => getTasks(signal)`에 전달해둔 `AbortSignal`을 통해 실제 fetch 요청 자체를 중단시키는 것입니다. 만약 이 취소 없이 드래그 시점에 이미 진행 중이던 GET 요청이 남아있다면, 낙관적 업데이트 이후 뒤늦게 성공 응답으로 도착해 TanStack Query가 "새로운 서버 상태"로 착각하고 캐시를 덮어써버립니다(뮤테이션이 실패한 것도 아닌데 카드가 원래 자리로 되돌아가 보이는 버그). `await`로 이 취소가 끝나길 기다린 뒤에야 다음 단계로 넘어가, 이 경쟁 상태를 원천 차단합니다.
2. 현재 캐시에서 이동 대상 카드 하나(`previousTask`)만 스냅샷으로 저장한 뒤, `moveTask` 순수 함수로 캐시를 낙관적으로 갱신합니다.
3. 요청이 실패하면 `onError`는 먼저 409(버전 충돌) 여부를 확인합니다. 409면 스냅샷 롤백 대신 서버 최신 상태를 반영하는 별도 분기로 처리하고(5번 참고), 그 외의 실패는 현재 `status`가 이 뮤테이션이 적용했던 값(`appliedStatus`)과 같을 때만 저장해둔 스냅샷(`previousTask`)의 **`status`만** 복원하고(`version`은 건드리지 않음), `useToast`로 실패를 알립니다. 그 사이 더 최신 이동이 이미 다른 값을 반영해뒀다면 되돌리지 않습니다.
4. 성공하면 `onSuccess`에서 서버가 반환한 최신 태스크(갱신된 `version` 포함)로 캐시를 교체합니다.

**스냅샷 범위 — 배열 전체가 아니라 카드 하나로 한정**:
- 처음에는 `previousTasks`로 배열 전체를 스냅샷했는데, 여러 카드를 동시에 이동시키는 경우 문제가 있었습니다. 카드 A와 B를 거의 동시에 옮기면, A의 `onMutate`가 캡처한 스냅샷에는 B의 이동 전 상태가 들어있습니다. 이후 B가 먼저 성공해 캐시에 반영된 뒤 A가 실패하면, A의 롤백이 저장해둔 배열 전체를 복원하면서 이미 성공한 B의 변경까지 되돌려버립니다.
- 이를 막기 위해 스냅샷과 복원 대상을 "이동시킨 카드 하나"로 좁혔습니다. 각 뮤테이션은 자신이 옮긴 카드의 이전 상태만 기억하고, 실패 시 현재 카드만 원래대로 되돌리므로 다른 카드의 동시 변경과 서로 간섭하지 않습니다.
- `src/api/mutations.test.tsx`에서 "카드 A 이동 실패가 이미 성공한 카드 B의 변경을 되돌리지 않는다"는 시나리오로 동작을 검증했습니다.

**롤백 방식 — "이전 스냅샷 복원" 채택, "서버 재조회" 기각**:
- 서버 재조회(invalidate 후 refetch)는 실패 상황에서 또 한 번 네트워크 요청을 보내는 것이라, 이마저 실패(GET도 `READ_FAILURE_RATE`만큼 실패 가능)하거나 지연될 수 있어 롤백 자체가 불안정해집니다.
- 반면 스냅샷 복원은 이미 메모리에 있는 값을 그대로 되돌리는 동기 연산이라 네트워크 상태와 무관하게 항상 즉시 성공합니다.
- 되돌릴 정확한 "이전 값"을 이미 `onMutate` 시점에 확보해뒀으므로, 서버에 다시 요청하지 않아도 됩니다.

**생성·수정·삭제의 세부 동작**: 위 이동의 동작 방식을 기반으로, 각각 다음과 같이 응용했습니다.
- **생성**: 서버가 확정한 `id`/`version`이 아직 없으므로 `temp-${crypto.randomUUID()}` 형식의 임시 `id`를 만들어 목록 맨 앞에 낙관적으로 추가합니다. 성공하면 임시 태스크를 서버가 반환한 실제 태스크로 교체하고, 실패하면 임시 태스크를 제거합니다. 생성은 기존 태스크와 충돌할 대상이 없는 새 태스크를 추가하는 작업이므로, `useMoveTask`처럼 태스크별 `scope`로 직렬화할 필요가 없어 표준 `useMutation()`을 사용합니다.
- **수정**: `useMoveTask`와 동일하게 `scope: { id }`로 태스크별 요청을 직렬화합니다. 이를 통해 같은 태스크에 대한 드래그 이동과 수정이 동시에 들어와도 서로 경쟁하지 않도록 했습니다. 실패 시에는 `title`/`priority`/`description`이 "이 mutation이 적용한 값"과 여전히 같을 때만 되돌립니다. 이는 최신 수정을 덮어쓰지 않기 위한 처리로, `useMoveTask`의 `appliedStatus` 가드를 세 필드에 확장한 방식입니다.
- **삭제**: 삭제도 태스크별 `scope`로 직렬화하고, 실패 시 스냅샷(`previousTask`)을 원래 있던 인덱스(`previousIndex`)에 `insertTaskAt`으로 복원합니다. `addTask`는 항상 목록 맨 앞에 추가하므로 삭제 롤백처럼 원래 위치를 지켜야 하는 경우에는 맞지 않아 별도 함수를 사용했습니다. 복원 시점에 이미 같은 `id`가 목록에 있으면 동일 태스크가 중복 삽입되지 않도록 추가하지 않습니다.

## 3. 경쟁 상태(race condition)

**서로 다른 카드를 동시에 이동시키는 경우**: 2번에서 설명한 대로, 롤백 스냅샷을 카드 하나 단위로 좁혀서 한 카드의 실패 롤백이 다른 카드의 동시 변경을 되돌리지 않도록 했습니다(`src/api/mutations.test.tsx`로 검증).

**같은 카드를 빠르게 연속 이동시키는 경우 ([Issue #8](https://github.com/park-moen/task-board-assignment/issues/8))**:

TanStack Query의 뮤테이션 `scope` 옵션으로 해결했습니다. 같은 `scope.id`를 가진 뮤테이션은 `MutationCache` 레벨에서 직렬 실행되므로(`onMutate`는 즉시 실행되어 낙관적 반영은 지연되지 않고, 실제 `mutationFn`만 앞선 요청이 끝날 때까지 대기), 같은 카드에 대한 요청이 응답 순서와 뒤바뀌어 도착하는 상황 자체가 발생하지 않습니다.

다만 `scope`는 `useMutation()` 훅을 생성하는 시점에 고정되는 옵션이라, Board에서 한 번만 호출되는 `useMoveTask()`로는 카드마다 다른 `scope.id`를 줄 수 없습니다. 그래서 훅 대신 `queryClient.getMutationCache().build(queryClient, options)`로 호출마다 새 뮤테이션을 만들고, 그 옵션에 `scope: { id: task.id }`를 넣는 방식으로 구현했습니다(`src/api/mutations.ts`). `MutationCache`는 뮤테이션을 만든 방식과 무관하게 `scope.id` 문자열이 같으면 직렬화하므로, 카드별 스코프가 정확히 동작합니다.

`scope`만으로는 부족해서 세 가지를 더 손봤습니다:
- **`version` 재조회**: 직렬화로 대기 중인 요청은 dispatch 시점이 아니라 실제 실행 시점에 캐시에서 최신 `version`을 다시 읽습니다. 그렇지 않으면 앞선 요청이 이미 서버 `version`을 올려놓은 상태라, 대기하던 요청이 낡은 `version`을 보내 409 충돌이 발생합니다.
- **`onSuccess` 부분 병합**: 서버 응답으로 태스크 전체를 교체하지 않고 `version`/`updatedAt`만 병합합니다. 안 그러면 앞선 요청의 응답이 뒤늦게 처리될 때, 그 사이 다음 이동이 이미 반영해둔 더 최신 `status`를 오래된 응답이 덮어써 화면이 잠깐 잘못된 상태로 되돌아갑니다(`src/api/mutations.test.tsx`의 두 번째 테스트로 검증).
- **`onError` 부분 복원**: 실패 시에도 태스크 전체(`previousTask`)가 아니라 `status`만 되돌립니다. 전체를 복원하면, 실패한 요청보다 먼저 성공해 이미 올려둔 `version`까지 되돌아가서, 그다음 대기 중이던 요청이 낡은 `version`을 보내 409가 발생합니다. `WRITE_FAILURE_RATE`를 0.5로 올려 실패를 섞은 상태로 카드를 여러 번 연속 이동시키는 수동 테스트에서 발견했고, `src/api/mutations.test.tsx`의 세 번째 테스트로 검증했습니다. 여기에 더해, 현재 `status`가 이 뮤테이션이 적용했던 값(`appliedStatus`)과 같은지도 확인한 뒤에만 되돌립니다 — 그 사이 같은 카드에 대한 더 최신 이동이 이미 다른 `status`를 반영해뒀다면, 실패한(더 오래된) 요청이 그 최신 상태를 덮어써서는 안 되기 때문입니다.

**왜 `Promise.race`/요청 취소 대신 `scope`인가**: 취소는 클라이언트가 응답을 무시하게 할 뿐, mock 서버(`src/mocks/handlers.ts`)가 취소 신호(`AbortSignal`)를 전혀 확인하지 않아 서버 쪽 처리는 그대로 완료됩니다. 즉 "취소했다고 믿는" 요청이 실제로는 서버 상태를 바꿔놓아 다음 요청과 예측 불가능한 충돌을 일으킬 수 있습니다. `scope`는 요청 자체를 미루기만 하고 항상 실제 응답을 기다리므로 서버와 클라이언트의 상태 인식이 항상 일치합니다.

## 4. 대량 데이터 성능 (5,000개)

5,000개 태스크를 전체 렌더링하면 초기 mount와 드래그 update에서 비용이 커져, 컬럼 내부 리스트에 가상화를 적용했습니다.

- **`@tanstack/react-virtual`을 선택한 이유 (`react-window`/`react-virtualized` 대비)**:
  - **Headless**: `useVirtualizer`는 리스트를 감싸는 자체 컴포넌트(`FixedSizeList`, `List` 등)를 강제하지 않고 크기/위치 계산 로직만 제공합니다. 기존 `Column`/`Card` 마크업 구조를 그대로 유지한 채 가상화만 끼워 넣을 수 있어, `react-window`/`react-virtualized`처럼 리스트 자체를 라이브러리 컴포넌트로 교체할 필요가 없었습니다.
  - **유지보수 상태**: 확인 시점(2026-07-08) 기준 `@tanstack/react-virtual`은 약 1주 전(3.14.5), `react-window`는 약 5달 전(2.2.7), `react-virtualized`는 약 17~18개월 전(9.22.6)이 최신 배포입니다. 특히 `react-virtualized`는 같은 원작자가 이후 `react-window`로 대체한 사실상 이전 세대 라이브러리입니다.
  - **동적 높이 측정 내장**: `measureElement`+`ResizeObserver`가 코어 API에 포함되어, 카드 높이가 균일하지 않게 바뀌어도([#11](https://github.com/park-moen/task-board-assignment/issues/11)에서 설명 필드 추가 등) 대응하기 쉽습니다. `react-window`의 `VariableSizeList`는 항목 높이가 바뀌면, 변경된 위치 이후의 높이 계산을 다시 하도록 `resetAfterIndex`를 직접 호출해야 해 상대적으로 번거롭습니다.

- **구현 방식**: `Column.tsx`에서 전체 `tasks` 배열을 직접 `map()`으로 렌더링하던 방식을 `@tanstack/react-virtual`의 `useVirtualizer` 기반 렌더링으로 변경했습니다. 이제 뷰포트에 보이는 카드와 `overscan`으로 지정한 여분의 카드만 DOM에 렌더링합니다(`overscan: 5`). 초기 위치 계산을 위한 카드 높이는 `estimateSize`로 제공하고, 실제 렌더링된 높이는 `measureElement` ref로 측정해 보정합니다.
  - 고정 높이 대신 실측(`measureElement`) 방식을 선택한 이유: 현재 카드는 제목/배지/날짜만 렌더링하므로 높이가 사실상 일정하지만, 향후 태그나 설명이 추가되면(#11) 카드마다 높이가 달라질 수 있습니다. 실측 방식은 추가 구현 비용이 작으면서도 이후 콘텐츠 높이 변화에 대응할 수 있어 선택했습니다.
  - `getItemKey: index => tasks[index].id`를 명시했습니다. 기본값처럼 index를 key로 사용하면, 카드가 다른 컬럼으로 이동해 배열 내 항목 위치가 밀릴 때 동일한 index 위치의 측정값이 다른 카드에 재사용될 수 있습니다. 현재는 카드 높이가 균일해 문제가 눈에 잘 띄지 않지만, 높이가 균일하다는 조건에 의존하지 않도록 안정적인 task id를 key로 사용했습니다.
  - 기존 flex `gap: 8px` 방식은 절대 위치(`transform: translateY`)로 배치되는 가상화 아이템에 그대로 적용하기 어렵습니다. 대신 `.card-row`에 `padding-bottom: 8px`을 적용해 측정되는 행 높이에 카드 간격이 포함되도록 처리했습니다.

- **측정**: React `<Profiler>`로 실제 commit 시간을 비교했습니다. 측정 시에는 개발 환경의 중복 렌더링이 결과에 섞이지 않도록 `main.tsx`의 `StrictMode`를 임시로 제거했고, 측정 후 다시 복원했습니다.

  | 상태 | mount commit 시간 | 드래그 1회당 update commit 시간 |
  |---|---|---|
  | 적용 전 (전체 5,000개 렌더링) | 76 ~ 92ms | 48 ~ 58ms |
  | 적용 후 (가상화) | 2ms | 1 ~ 3ms |

  mount commit 시간은 약 35 ~ 40배, 드래그 1회당 update commit 시간은 약 20 ~ 30배 개선되었습니다.

  <table>
  <tr><th>적용 전 (mount commit)</th><th>적용 후 (mount commit)</th></tr>
  <tr>
  <td><img width="662" height="54" alt="가상화 적용 전 mount commit 측정 결과" src="https://github.com/user-attachments/assets/397e3877-11c4-46ba-8d0c-b2e61fa6c1c4" /></td>
  <td><img width="672" height="55" alt="가상화 적용 후 mount commit 측정 결과" src="https://github.com/user-attachments/assets/3b1feb42-149a-449a-bf74-a686a79b50b0" /></td>
  </tr>
  <tr><th>적용 전 (드래그 update commit)</th><th>적용 후 (드래그 update commit)</th></tr>
  <tr>
  <td><img width="675" height="127" alt="가상화 적용 전 드래그 update commit 측정 결과" src="https://github.com/user-attachments/assets/5cd08203-184f-466c-a6c1-f03c8656e713" /></td>
  <td><img width="674" height="180" alt="가상화 적용 후 드래그 update commit 측정 결과" src="https://github.com/user-attachments/assets/f1a8ae9b-c942-4874-931f-825cfa45a05c" /></td>
  </tr>
  </table>

- **트레이드오프**: 가상화 적용 전에는 전체 카드가 DOM에 존재한 상태에서 `overflow-y: auto`로 스크롤되므로, 스크롤 자체로 인한 React 리렌더는 발생하지 않았습니다. 반면 가상화 적용 후에는 스크롤 위치에 따라 가시 영역에 포함되는 카드 범위가 바뀌기 때문에 React 리렌더가 발생합니다(React DevTools "Highlight updates"로 확인). 다만 스크롤 중 발생하는 개별 리렌더 비용은 측정된 update 커밋 시간 기준 1 ~ 3ms 수준으로, 60fps의 프레임 예산인 16.6ms 안에 들어옵니다. 반대로 가상화 적용 전에는 카드 하나를 이동하는 상호작용에서도 5,000개 카드 전체에 대한 렌더링/조정 비용이 발생했고, 이 비용은 48 ~ 58ms 수준이었습니다. 즉, 가상화는 "빈번하지만 저렴한 스크롤 업데이트"를 감수하는 대신 "상호작용마다 발생하던 비싼 전체 목록 업데이트"를 줄이는 선택입니다. 측정 결과 이 프로젝트에서는 후자의 비용이 더 크기 때문에, 가상화 적용이 전체 상호작용 성능에 더 유리합니다.

  <table>
  <tr><th>적용 전 (스크롤 시 리렌더 없음)</th><th>적용 후 (스크롤 시 리렌더 발생)</th></tr>
  <tr>
  <td><img width="673" height="57" alt="scroll-before" src="https://github.com/user-attachments/assets/de1802ca-229c-46db-8030-385c9cafe465" /></td>
  <td><img width="669" height="347" alt="scroll-after" src="https://github.com/user-attachments/assets/dcbe26a0-286d-4cc8-a92c-02cc7de9e972" /></td>
  </tr>
  </table>


- **검색과의 상호작용 ([Issue #10](https://github.com/park-moen/task-board-assignment/issues/10), [Issue #20](https://github.com/park-moen/task-board-assignment/issues/20))**: 가상화는 드래그 이동뿐 아니라 검색으로 필터링된 결과 목록에도 동일하게 적용됩니다. 이를 확인하기 위해 검색어 입력이 바뀔 때 실제 DOM에 추가·제거되는 카드 노드 수를 `MutationObserver`로 임시 계측했고, 측정 후 제거했습니다. 측정 결과, 적용 전에는 매칭된 태스크 수만큼(예: "1" 입력 시 2,084개) 카드가 DOM에 렌더링됐지만, 적용 후에는 검색 결과 수와 무관하게 뷰포트와 `overscan`을 합친 범위(~40개 내외)로 유지되었습니다.

  다만 "DOM 노드 수가 일정하다"는 것이 "DOM 변경이 발생하지 않는다"는 의미는 아닙니다. 카드는 `getItemKey`로 태스크 id를 기준으로 식별되므로, 검색어가 바뀌어 필터링된 배열의 구성이 달라지면(예: 뷰포트에 보이던 카드가 더 이상 매칭되지 않는 경우) React는 사라진 id의 카드를 제거하고 새로 매칭된 id의 카드를 추가합니다. 즉 총 노드 수(~40개 내외)는 유지되더라도 화면에 렌더링되는 카드 구성은 검색 결과에 따라 달라질 수 있으며, 이 추가/제거 범위는 매번 뷰포트 크기 이내로 제한됩니다.

  이 측정으로 Issue #10에서 예상했던 "가상화와 함께 적용하면 대량 데이터에서도 렌더링 부담을 낮춘 검색 경험을 제공한다"는 점을 확인했습니다.

  <table>
  <tr><th>적용 전 (검색 타이핑 시 DOM 변화)</th><th>적용 후 (검색 타이핑 시 DOM 변화)</th></tr>
  <tr>
  <td><img width="757" height="107" alt="가상화 적용 전 검색 타이핑 시 DOM 변화 측정 결과" src="https://github.com/user-attachments/assets/5de7ad09-dbb4-42bd-ab9f-d654668793b3" /></td>
  <td><img width="758" height="100" alt="가상화 적용 후 검색 타이핑 시 DOM 변화 측정 결과" src="https://github.com/user-attachments/assets/716349a9-8d15-4403-a20a-26cc7e8b1f77" /></td>
  </tr>
  </table>

  가상화가 DOM 노드 수를 제한하더라도, 디바운싱 적용 전에는 `query`가 매 키 입력마다 즉시 `filterByTitle`의 기준값으로 사용되어 `"1"`, `"12"`, `"123"` 같은 중간 검색어마다 필터링·컬럼별 그룹 계산·DOM 변경이 각각 발생했습니다. 이 비용이 눈에 띄는 성능 문제는 아니었지만, 빠르게 여러 글자를 입력하는 동안 중간 상태에 대한 계산과 렌더는 불필요했습니다.

  그래서 Issue #20에서 `src/hooks/useDebouncedValue.ts`로 제네릭 디바운스 훅을 만들고, `Board.tsx`에서 `filterByTitle`에 넘기는 값만 `useDebouncedValue(query, 300)`으로 교체했습니다. Input에 표시되는 값(`query`)은 즉시 반영해 타이핑 반응성은 유지하고, 실제 필터링과 컬럼별 그룹 계산에만 300ms 지연을 적용했습니다. 같은 `MutationObserver` 계측으로 "123"을 빠르게 연속 입력했을 때, 디바운싱 적용 후에는 타이핑이 멈추고 300ms가 지난 뒤 최종값 `"123"`에 대해서만 한 번의 DOM 변경이 발생함을 확인했습니다.

  300ms를 택한 이유는 너무 짧으면(예: 100ms) 빠른 타이핑 중간에도 재계산이 섞여 들어가 디바운싱 효과가 줄고, 너무 길면(예: 600ms 이상) 타이핑을 멈춘 뒤 결과가 반영되기까지 체감 지연이 생기기 때문입니다. 그래서 일반적인 타이핑 간격보다 조금 길지만, 사용자가 "느리다"고 느끼지 않는 범위인 300ms를 선택했습니다.

  <table>
  <tr><th>디바운싱 적용 후 ("123" 연속 입력 시 DOM 변화)</th></tr>
  <tr>
  <td><img width="727" height="53" alt="디바운싱 적용 후 검색 타이핑 시 DOM 변화 측정 결과" src="https://github.com/user-attachments/assets/1c11ea98-68c5-4f0d-a9fb-94b839a19cd7" /></td>
  </tr>
  </table>

## 5. 정답이 없던 결정들 (명세서에 명시되지 않은 항목)

세 질문 모두 [Issue #19](https://github.com/park-moen/task-board-assignment/issues/19)에서 정책을 먼저 정한 뒤 구현했습니다. 기본 원칙은 "사용자에게 실패 원인을 명확히 알리되, 서버 상태를 알 수 없는 경우에는 안전하게 롤백하고, 서버가 최신 상태를 알려주는 경우에는 그 값을 신뢰한다"입니다.

**네트워크가 완전히 끊겼을 때**: `network`로 분류해, 기존과 동일하게 스냅샷 롤백은 하되 Toast 문구만 "네트워크 연결을 확인해주세요."로 구분했습니다(`toFailureToastMessage`). 서버 응답을 받지 못한 상황에서는 요청이 실제로 처리됐는지 클라이언트가 알 수 없으므로, 안전한 기본값으로 롤백을 유지하되 실패 원인만 명확히 알려주는 쪽을 택했습니다. 이 프로젝트의 API 클라이언트는 서버 응답이 있는 실패를 `ApiError`로 변환하므로, `ApiError`가 아닌 실패는 요청 자체가 완료되지 못한 경우로 보고 `network`로 분류합니다. 단, `AbortError`는 의도적 취소이므로 `aborted`로 분리해 네트워크 실패와 구분합니다.

**409 충돌 시**: `onMutate` 직전의 로컬 스냅샷으로 되돌리지 않고, 서버가 응답과 함께 반환한 최신 상태(`ApiError.payload.current`, `getConflictServerTask`로 추출)를 조건부로 캐시에 반영합니다. 이때 "다른 곳에서 먼저 변경되어 최신 내용으로 갱신했습니다."라는 별도 Toast를 보여줍니다. 로컬 스냅샷 복원을 택하지 않은 이유는, 충돌 시점의 스냅샷이 "내가 요청을 보내기 전의 클라이언트 캐시 값"일 뿐 서버의 실제 최신 상태가 아니기 때문입니다. 서버가 최신값을 응답에 담아 반환했는데 이를 버리고 더 오래된 로컬 값으로 되돌리면 사용자에게 잘못된 정보를 보여줄 수 있습니다. 다만 서버 상태 반영은 현재 캐시 값이 `onMutate`에서 미리 반영한 상태와 여전히 같을 때만 수행합니다(`applyServerSnapshotIfStillApplied`). `scope`로 요청은 직렬화되지만 `onMutate`는 즉시 실행되므로, 대기 중 더 최신 변경이 같은 태스크에 반영될 수 있습니다. 이 경우 뒤늦게 도착한 409 응답이 그 최신 값을 덮어쓰지 않도록 서버 상태 적용을 건너뜁니다.

**실패한 쓰기의 재시도**: 쓰기 요청에는 별도 자동 재시도나 재시도 UI를 추가하지 않았습니다. 실패하면 `onError`에서 `onMutate`로 미리 바꿔둔 상태를 되돌리거나 서버 최신 상태로 갱신하고, Toast로 실패 원인을 알려 사용자가 필요하면 같은 동작을 다시 수행하게 했습니다.

자동 재시도와 재시도 UI를 모두 추가하지 않은 이유는, 실패한 쓰기를 나중에 다시 실행하려면 요청 종류별로 다른 안전성 검사가 필요하기 때문입니다. 생성(POST)은 서버가 요청을 처리했지만 네트워크 문제로 클라이언트가 응답을 받지 못한 경우, 같은 요청을 다시 보내면 같은 태스크가 중복 생성될 수 있습니다. 예를 들어 서버에는 이미 "회의 준비" 태스크가 생성됐지만 클라이언트가 응답을 받기 전에 연결이 끊기면, 자동 재시도가 같은 생성 요청을 다시 보내 두 번째 "회의 준비" 태스크가 생길 수 있습니다. 수정·삭제·이동은 실패 이후 같은 태스크가 다시 변경되었는지, 현재 캐시 상태가 재시도해도 되는 상태인지 확인해야 합니다. 특히 수정/이동(PATCH)은 `version` 기반 충돌 감지를 사용하고, 이동은 연속 드래그와 `scope`까지 얽혀 있어 오래된 재시도가 더 최신 상태를 덮을 위험이 있습니다. 따라서 재시도 기능은 단순히 요청을 다시 보내는 버튼이 아니라 "마지막 실패 작업만 재시도", "현재 상태가 실패 당시 전제와 달라졌으면 재시도 차단" 같은 정책까지 함께 설계해야 하므로, 이번 구현 범위는 실패 상태를 정리하고 원인을 안내하는 수준으로 제한했습니다.

반대로 조회(GET)는 같은 요청을 반복해도 서버 데이터를 바꾸지 않으므로, TanStack Query의 기본 조회 재시도 정책(실패 시 3회)을 그대로 유지했습니다.

정리하면, 네트워크 실패는 로컬 스냅샷으로 복원하고 네트워크 전용 Toast를 보여주며, 409 충돌은 로컬 스냅샷 대신 서버 최신 상태로 갱신합니다. 실패한 쓰기는 자동 재시도나 재시도 UI 없이 실패 상태를 정리하고 원인을 안내하는 수준으로 제한했습니다. 구현은 `src/lib/errors.ts`의 실패 분류(`conflict`/`network`/`server`/`aborted`)와 `src/api/mutations.ts`의 `onError` 분기로 반영했습니다.

## 6. 그 외 트레이드오프 / 남은 한계
- 시간 제약으로 포기한 것, 알고 있는 버그·한계, 더 있었다면 했을 것.

**생성/수정 실패 후 폼 입력값을 보존하지 못하는 경우 (남은 UX 한계)**

현재 생성/수정 폼은 제출 직후 모달을 닫고(`Board.tsx`의 `setFormState(null)`), 실패 여부는 mutation의 `onError`에서 Toast로 안내합니다. 이 때문에 생성이나 수정 요청이 실패하면 사용자가 입력했던 값이 폼에 남아 있지 않고, 같은 작업을 다시 시도하려면 모달을 다시 열어 내용을 다시 입력해야 합니다.

다만 생성 실패에서 입력값을 그대로 보존하고 재제출을 허용하면, 5번에서 설명한 것처럼 서버에는 이미 태스크가 생성됐지만 클라이언트가 응답을 받지 못한 경우 같은 태스크가 중복 생성될 수 있습니다. 따라서 폼 값 보존을 개선하려면 단순히 모달을 다시 열어주는 것뿐 아니라, 생성 요청의 중복 방지 방식(예: 클라이언트 생성 키 또는 서버 상태 확인)과 수정/삭제/이동의 최신 상태 검사를 함께 설계해야 합니다.

이번 구현에서는 Priority 1/2 항목과 409·네트워크 실패 처리 정책을 먼저 마무리하는 것을 우선했고, 시간 제약상 폼 값 보존과 안전한 재제출 정책까지는 구현하지 못했습니다. 따라서 현재는 실패 상태를 정리하고 Toast로 원인을 안내하는 수준으로 범위를 제한했습니다.

**다중 탭 동기화 미구현 (범위 제외)**

한 탭에서 태스크를 변경해도 다른 탭 화면에는 새로고침 전까지 반영되지 않습니다. 원인은 mock 서버(`src/mocks/db.ts`) 구조에 있습니다 — `store`는 모듈 로드 시 `localStorage`에서 한 번만 읽어오는 탭별 독립 메모리 변수이고, 쓰기 성공 시 `localStorage`에 저장은 하지만 다른 탭이 이 변경을 실시간으로 감지할 `storage` 이벤트 리스너가 없습니다. 그래서 각 탭의 mock "서버"는 사실상 독립적으로 동작하고, `localStorage`를 통한 동기화는 새 페이지 로드 시점에만 일어납니다.

구현하려면 각 탭에서 `window.addEventListener('storage', ...)`로 다른 탭의 변경을 감지하고, TanStack Query의 `queryClient.setQueryData`/`invalidateQueries`로 현재 탭 캐시를 갱신하는 작업이 추가로 필요합니다. README Priority 2의 권장 항목이라 필수는 아니었고, Priority 1 항목과 409·네트워크 정책, 검색 디바운싱을 먼저 견고하게 마무리하는 것을 우선해 시간 제약상 구현하지 않았습니다.

**같은 카드에서 실패가 2번 이상 연속으로 겹치는 경우 (알려진 한계)**

`useMoveTask`(`src/api/mutations.ts`)의 `onError`는 실패한 뮤테이션 자신의 `onMutate` 시점 스냅샷(`previousTask`)으로 되돌립니다. 이 스냅샷은 "서버가 확인해준 값"이 아니라 "그 뮤테이션 직전의 로컬 캐시 값"이라서, 같은 카드에 대해 차례를 기다리던 요청이 두 개 이상 연달아 실패하면 롤백이 한 칸씩만 되돌아가다가 실제로는 서버에 반영된 적 없는 중간값에서 멈출 수 있습니다(예: `todo`→`in-progress`로 이동한 첫 번째 요청은 성공하고, 이어서 `in-progress`→`done`, `done`→`todo`로 연달아 보낸 두 요청이 모두 실패하면, 최종 상태가 두 번째 요청(`in-progress`→`done`)이 낙관적으로 세팅했던 `done`으로 남고, 첫 번째 요청이 확정한 서버 상태 `in-progress`로 돌아가지 않음).

- 단일 실패, 혹은 "성공 이후 실패 1회"는 `src/api/mutations.test.tsx`로 검증되어 있고 정상 동작합니다.
- 이 한계는 카드별로 "서버가 마지막으로 확인해준 상태"를 별도로 추적(예: id별 확정 상태 맵)해서 롤백 대상을 스냅샷 체인이 아니라 이 맵의 값으로 바꾸면 해결 가능하다고 판단했습니다.
- 시간 제약상 Priority 1/2 항목을 우선 완료한 뒤, 시간이 남으면 구현할 예정입니다.
