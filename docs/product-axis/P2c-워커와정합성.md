# P2c — v2 워커 + 실행 버튼 + 정합성 대조 (e~g)

**정의역**: e(워커) · f(버튼) · g(정합성 대조) · 미분류 3건 판정.
**기점**: `e7179c2` (P2b) · **기준선 A**: dress-state md5 `14e50b8919a63a7f9799220b86e508a9` — **불변**.
**합격 기준(§g)**: 브라우저 풀 시뮬이 스크립트와 같은 9채널을 낸다.

## 결론

**두 env 모두 9채널 전부 일치했다.** 인쇄 자릿수까지 같다 — 갈린 채널 0건이므로
「크게 갈리면 원인을 찾는다」 절은 발동하지 않았다. 브라우저 재실행 2회도 서로 동일했다.

---

## §e 워커

`src/workers/patternDressWorker.ts` (44줄) — **물리 0줄**. v1 `garmentWorker.ts:151`의 M0
구조를 그대로 따른다: 물리는 `src/lib/`가 하고 워커는 메시지와 상태 객체만 관리한다.
**v1 워커는 한 줄도 건드리지 않았다**(구 경로 비트 동일성 하드 게이트).

파이프라인 본체는 `src/lib/patternDressCore.ts`의 `runPatternDressing`이다.

```ts
runPatternDressing(fixture, opts): PatternDressResult
```

**입력** `PatternDressOptions` — 스크립트가 env로 받던 물리 스위치를 그대로 옮겼고
**기본값 = 스크립트의 「미설정」**이다(env는 채널 · P2b (b) 등재분).

| 옵션 | 대응 env | 기본 | 근거 |
|---|---|---|---|
| `ringTotal` | `RINGTOTAL` | true | 미설정 = 상한 on. **기준선 A는 false** |
| `marginAllM` | `MARGIN_ALL` | `COLLISION_MARGIN` | 102 §1 |
| `torsoCap` | `TORSOCAP` | false | 45회차 승격 |
| `armCap` | `ARMCAP` | true | 94회차 |
| `singleDeepest` | `SINGLE` | true | 42회차 처방 A |
| `s0fix` | `S0FIX` | true | 배치 관통 교정 |
| `skeletonSign` | `SKELSIGN` | false | 부호 기준 radial |
| `pinDress` | `PINDRESS` | false | 착장 소프트 앵커 off |
| `seconds` | `SECONDS` | 25 (=1500프레임) | 프레임 예산 |
| `garmentDims` | — | fixture `layout`/`pose`에서 도출 | 하네스와 **같은 옷**을 입어야 §g가 성립 |

**출력** `PatternDressResult` — `ok` · `error` · `state` · `frames` · `retry` · `elapsedMs` ·
`positions`/`tris`/`uv`(transfer) · `panelStarts`/`panelCounts`/`panelTriRanges` · `seams` ·
`metrics`(§g 9채널).

**계기 훅은 넘기지 않는다**(P2b §2 「계기 6」). 물리 훅 3종(`createAnchorPinRamp` ·
`createRingLimitRamp` · `projectRingTotalLength`)과 `place`/`countPenetrating`/`diverged`/
`maxSeamGapM`/`maxDelta20Mm`만 배선한다.

### `placementRestGate` (물리) 의 전달 형식

코어에서 **throw**한다(스크립트와 같다 — 실행을 끊는다). 브라우저에는 프로세스 종료가
없으므로 워커가 잡아 **실패 상태**로 돌려준다: `{ ok:false, error, state:"ABORT", metrics:null }`.
버튼은 그 `error`를 콘솔에 찍고 실행 상태를 푼다. 좌표는 반영하지 않는다.

### 알려진 이중 경로 (이번 판이 닫지 못한 것)

`scripts/dressPattern.ts`는 **아직 `runPatternDressing`을 부르지 않는다.** 같은 호출 순서를
자기 안에 갖고 있다 — 계기 50여 종이 그 사이에 끼어 있어 이번 판 정의역(e~g)에서
갈라내지 않았다. 물리 «로직»은 복제되지 않았지만(전부 공유 모듈 호출) **순서는 두 벌**이다.

지금 그 이중성을 막는 것은 §g 실측뿐이다. 스크립트를 코어 위로 올리는 것이 다음 판 숙제다.

---

## §f 실행 버튼

`src/components/DressButton.tsx` (77줄) — DEV + `?patterncore=1`에서만 뜬다.
`App.tsx`에서 캔버스 위 오버레이로 붙인다(3줄).

- 누르면 워커 생성 → 풀 시뮬 → 완료 시 `window` CustomEvent로 결과 전달
- **UI 안 얼었다**: 실행 중 마우스·카메라 조작 가능, 버튼 라벨이 `S1 f=…`→`S2 f=…`로 갱신
  (30프레임마다 진행 메시지)
- `PatternPreview`는 이벤트를 받아 **정점 좌표만 덮어쓴다** — 지오메트리 재생성 0,
  UV·인덱스·시접 브리지 위상 불변
- **`?patternstate=1`의 옛 dress-state fetch 경로는 그대로 남아 있다**(제거 0). §g 육안
  대조가 그 경로를 실제로 썼다
- store 스키마는 늘리지 않았다(CustomEvent 선택)

**미구현(다음 판, 프롬프트 명시)**: 진행률 UI · 취소 · 에러 복구 · 재실행 경쟁.
실행 중 버튼 비활성화만 있다.

> **관측 1건**: 대조 도중 같은 결과가 콘솔에 2회 인쇄된 구간이 있었다(11:34:44 · 두 줄이
> 값·경과까지 동일). 워커 2개가 겹쳐 돈 것으로 보인다 — `busy` 가드가 클릭/마운트 경쟁을
> 못 막은 것. **원인 미확정**이고 재실행 경쟁 처리가 다음 판 항목이므로 여기 기록만 한다.
> 결과값에는 영향이 없다(두 실행이 같은 값).

---

## §g 정합성 대조 — **합격**

옷 = fixture `layout` 도출(= 하네스와 같은 옷) · 몸 = 같은 fixture.
브라우저는 `?patterncore=1[&ringtotal=0]`, 스크립트는 `[RINGTOTAL=0] PATTERNCORE=1 npm run dress:pattern`.

### 기준선 A 조건 (`RINGTOTAL=0` / `?ringtotal=0`)

| 채널 | 스크립트 | 브라우저 | 차 |
|---|---|---|---|
| cov 몸통(정식·팔 제외) | 6.8% (118/1728) | 6.8% (118/1728) | 0 |
| maxStrain | 2.661 (정점 2146) | 2.661 (정점 2146) | 0 |
| maxSeamGap | 11.14mm | 11.14mm | 0 |
| Δ20 | 5.16mm | 5.16mm | 0 |
| 자기교차(엣지-삼각형) | 1889 | 1889 | 0 |
| 관통(레이 패리티) | 50 / 5244 | 50 / 5244 | 0 |
| 종료 | DONE f=260 (retry 0) | DONE f=260 (retry 0) | 0 |
| 밑단 사슬 합 | 112.57cm (앞 56.15 / 뒤 56.43) | 112.57cm (앞 56.15 / 뒤 56.43) | 0 |
| 목선 링 | 61.80cm | 61.80cm | 0 |

### 기본 env (`RINGTOTAL` 미설정 / `?patterncore=1`) — 투영 경로 대조

`projectRingTotalLength`가 실제로 발화하는 조건이다(기준선 A 조건에서는 0회 발화).

| 채널 | 스크립트 | 브라우저 | 차 |
|---|---|---|---|
| cov 몸통 | 6.9% (119/1728) | 6.9% (119/1728) | 0 |
| maxStrain | 2.463 (정점 2146) | 2.463 (정점 2146) | 0 |
| maxSeamGap | 11.20mm | 11.20mm | 0 |
| Δ20 | 5.25mm | 5.25mm | 0 |
| 자기교차 | 1917 | 1917 | 0 |
| 관통 | 51 / 5244 | 51 / 5244 | 0 |
| 종료 | DONE f=260 | DONE f=260 | 0 |
| 밑단 합 | 112.28cm (앞 55.65 / 뒤 56.63) | 112.28cm (앞 55.65 / 뒤 56.63) | 0 |
| 목선 링 | 54.05cm | 54.05cm | 0 |

**비트 동일까지 요구하지 않았는데 인쇄 자릿수는 전부 같다.** 브라우저 재실행 2회
(11:32:53 · 11:38:49)도 서로 동일 — 브라우저 경로도 실행 간 결정적이다.

### 실행 시간 (참고 — 머신 부하에 따라 크게 흔들린다)

| | 벽시계 |
|---|---|
| 워커(기준선 A 조건) | 15.8s · 29.1s (2회) |
| 워커(기본 env) | 38.6s |
| 스크립트(기준선 A 조건) | 19.0s ~ 32.1s |
| 스크립트(기본 env) | 48.7s (그 실행 물리 187ms/프레임 — 부하 구간) |

같은 코드가 같은 판에서 2배 흔들린다. **단일 측정으로 예산을 판정하지 말 것.**

### 육안 대조 (front 1장)

`docs/captures/P2c-워커정합/front-워커.jpg`(버튼 실행 결과) ↔
`docs/captures/P2c-워커정합/front-스크립트.jpg`(`?patternstate=1` — 스크립트 덤프).
같은 카메라·같은 뷰포트(1389×763). 실루엣·소매 길이·밑단 높이·목선 개구·체커 왜곡
분포가 구별되지 않는다. 옆선 세로 틈은 양쪽 다 있다(렌더 사실 — 시접 브리지 미배선분,
`dressPattern` 관측 주석과 같은 것).

---

## § 미분류 3건 판정 (P2b §2-3)

판별 기준은 P2b와 같다 — **실행 흐름을 바꾸면 물리, 인쇄만 하면 계기.**
셋 다 코드 판독으로 갈렸다. 남은 미분류 0건.

| 항목 | 판정 | 근거(코드) | 워커 배선 |
|---|---|---|---|
| `gateArmed` | **물리** | `placementRestGate`는 throw로 실행을 끊는다. `gateArmed`는 그 throw가 **발생할 수 있는 시점**을 정한다 ⟹ 제어 흐름을 바꾼다. 값(판정식)이 계기라는 것과 별개다 | 포함 |
| `resolverMissCount` | **계기** | `bvhFromArrays.ts:31-33,246` — 모듈 전역 카운터, `getResolverMissCount`만 읽는다. `continue`는 카운터와 무관하게 실행된다 ⟹ 좌표·흐름 무관 | 제외 |
| `sim.setCollarRing` | **물리** | `clothPhysics.ts:295-303`이 `collarRing`에 rest를 심고 `:314` `limitCollarStrain`이 그것을 순회한다 ⟹ 제약 집합 자체 | 포함 |

**부수 등재(계기 오염 1건)**: `resolverMissCount`는 전역이라 `adsorbRun`(스크래치 사본에
`unified`를 한 번 더 돌리는 35회차 계기)이 값을 부풀린다. 물리에는 무관하지만 그 카운터를
인용할 때는 「계기 호출분이 섞여 있다」를 병기해야 한다.

---

## § 기준선 A 상태

**불변.** `14e50b8919a63a7f9799220b86e508a9` — §g 대조 후 재실행으로 확인했다.
이번 판은 `scripts/dressPattern.ts`를 **한 줄도 고치지 않았다**(신규 파일 3 + `App.tsx` 3줄 +
`PatternPreview.tsx` 결과 반영 이펙트).

## § 남은 것

| | 내용 |
|---|---|
| P2d-1 | **스크립트를 `patternDressCore` 위로 올린다** — 이중 경로(§e) 해소. md5 게이트 유지 |
| P2d-2 | 재실행 경쟁·취소·진행률 UI · 에러 복구(§f 미구현분 + 위 관측 1건) |
| P2c에서 제외(프롬프트) | 품 배선 · bodySize 배선 · wearable 게이트 · 프리뷰 절단 · UI 디자인 · 옷 타입 · 물리 개선 · v1 워커 수정 |

**stale build 주의**: `patternDressWorker.ts` / `patternDressCore.ts`를 만지면 Vite HMR이
기존 Worker 인스턴스를 갱신하지 않는다 → 하드 리프레시(Cmd+Shift+R).
