# P2b — v2 착장 코어 추출 (a~d)

**정의역**: a~d 추출만. 워커 작성(e) · 버튼(f) · 정합성 확인(g)은 다음 판.
**성격**: 항등 리팩터. 값 변경 0 · 물리 로직 수정 0 · 계기 삭제 0 · "하는 김에 정리" 0.
**기점**: `51c53f3` (P2a) · **종점**: `1bbcb14`
**기준선 A**: dress-state md5 `14e50b8919a63a7f9799220b86e508a9` · patternHash `9f7ba80b3497` ·
fixture `9e8b2bf13925` — **a~d 전 단계에서 불변**.

---

## §1 단계별 커밋과 게이트

각 단계는 **자기 커밋 하나**다(깨진 지점을 이분하기 위한 조건). 게이트 env는
`RINGTOTAL=0 PATTERNCORE=1` — 기준선 A를 정의한 그 env다(metrics-log R0).

| 단계 | 커밋 | 옮긴 것 | 목적지 | md5 |
|---|---|---|---|---|
| a | `ea192fc` | `unified` 리졸버(mesh → 패널별 캡슐) | `garmentFrame.createPatternUnifiedResolver` | `14e50b89…` 불변 |
| b | `d89c71e` | 마찰 SDF 굽기 3단(bbox → 부호 샘플러 → bake) | `sdfCollision.bakePatternFrictionSdf` | `14e50b89…` 불변 |
| c | `6b85ad1` | 세션 `env` 조립 + 마찰 2종 배선 | `garmentFrame.makePatternSessionEnv` | `14e50b89…` 불변 |
| d | `1bbcb14` | `runDressing` **물리 훅** 3종 | `patternDressHooks.ts`(신규) | `14e50b89…` 불변 |

### 채널 9종 대조 — a~d 전 단계 동일

| 채널 | 기준선 A | a | b | c | d |
|---|---|---|---|---|---|
| cov 몸통(정식·팔 제외) | 6.8% (118/1728) | 〃 | 〃 | 〃 | 〃 |
| maxStrain | 2.661 (정점 2146) | 〃 | 〃 | 〃 | 〃 |
| maxSeamGap | 11.14mm | 〃 | 〃 | 〃 | 〃 |
| Δ20 | 5.16mm | 〃 | 〃 | 〃 | 〃 |
| 자기교차(엣지-삼각형) | 1889 | 〃 | 〃 | 〃 | 〃 |
| 관통(레이 패리티) | 50 / 5244 | 〃 | 〃 | 〃 | 〃 |
| 정착 프레임 | DONE f=260 | 〃 | 〃 | 〃 | 〃 |
| 밑단 사슬 합 | 112.57cm | 〃 | 〃 | 〃 | 〃 |
| 목선 링 | 61.80cm | 〃 | 〃 | 〃 | 〃 |

`npx tsc -b` — a~d 전 단계 통과.

### 보조 대조 1건 (d)

`RINGTOTAL=0` 게이트는 **링 총 길이 투영을 0회 발화**시킨다(상한 0). 그 경로가
(d)에서 이사했으므로 게이트만으로는 미검증이다. 기본 env(`PATTERNCORE=1`, 투영 on)로
따로 대조했다:

| | 기준값(사전 실측) | (d) |
|---|---|---|
| dress-state md5 | `a20ff9e3091ed3017d68686b2e665a7c` | 동일 |
| 자기교차 | 1917 | 1917 |
| 관통 | 51 / 5244 | 51 / 5244 |
| 투영 발화 | 228회 (0.88/프레임) | 228회 (0.88/프레임) |

---

## §1-1 정정 기록 — (b)에서 md5가 깨진 것으로 보였던 건

(b) 첫 실행이 md5 `a20ff9e3…` · 자기교차 1917 · 관통 51을 냈다. 규칙대로 그 단계에서
멈추고 원복해 이분했다. **원인은 코드가 아니라 env였다** — (b) 실행에서
`RINGTOTAL=0`을 빠뜨렸다.

이분 근거(전부 실측):

- (b) 원복 후 같은 env(`PATTERNCORE=1`)로 재실행 → **여전히** `a20ff9e3…`
- (a) 커밋 상태에서 2회 재실행 → 2회 모두 `a20ff9e3…`(실행 간 결정적)
- (a) **이전** 상태(`ea192fc^`)로 되돌려 실행 → 역시 `a20ff9e3…`
- 즉 `a20ff9e3…`는 **`RINGTOTAL` 기본(투영 on) 실행의 값**이고, 기준선 A는
  `RINGTOTAL=0` 실행의 값이다. 두 값 모두 재현된다.

**등재**: 기준선 대조에서 **env 줄을 채널로 취급한다.** 하네스가 이미
"재현하려면 위 env 줄을 그대로 쓴다"를 매 실행 인쇄하는데(함정 26) 그 줄을 대조
항목으로 삼지 않았다. 채널 9종이 전부 움직였는데도 원인이 코드가 아니었다 —
**값이 갈렸을 때 코드부터 의심하면 이분이 3회 낭비된다.**

---

## §2 `runDressing` 훅 분류

**판별 기준**: 실행 흐름을 바꾸면 **물리**, 인쇄만 하면 **계기**.
애매한 것은 분류하지 않고 §2-3에 목록으로 남긴다(추측 분류 금지).

### §2-1 물리

| 훅 | 왜 물리인가 | 이 판 |
|---|---|---|
| `setAnchorHard` | `sim.pinned` 쓰기 + `setParticle` 위치 램프 | **이사** → `createAnchorPinRamp` |
| `beforeStep`의 링 상한 램프 | `env.collarStrainLimit`를 프레임마다 갱신 | **이사** → `createRingLimitRamp` |
| `onFrame`의 링 총 길이 투영 | `sim.positions` 등방 축소 | **이사** → `projectRingTotalLength` |
| `place` | 좌표 전량 재작성(배치 + 관통 교정) | 미이사 — 사유 §2-4 |
| `countPenetrating` | 반환값이 RETRY 분기를 가른다 | 미이사 |
| `diverged` | 반환값이 ABORT 분기를 가른다 | 미이사 |
| `maxSeamGapM` | S1→S2 전이 조건 | 미이사 |
| `maxDelta20Mm` | 정착 판정(S3→DONE) | 미이사 — 사유 §2-4 |
| `setAnchorStrength`(runDressing 인자) | `env.pinStrength` 갱신 | 미이사 — 한 줄 · env 소유가 하네스 |
| `placementRestGate` | **throw로 실행을 끊는다** — 판정식은 계기지만 작용은 물리 | 미이사 |

### §2-2 계기

| 훅 / 요소 | 근거 |
|---|---|
| `stateNote` | 전이 로그 한 줄 — 인쇄만 |
| `beforeStep`의 프로브 전량 | restMap · 38계기A · 39계기 D/B · hem 3종 · 35계기 추적 · 31계기 적분 상한 · probeArmed 무장 |
| `onFrame`의 나머지 전량 | 31계기 패스별 분해 · 29계기 링 y 시계열 · 27계기 3종 · 봉합 닫힘 로그 · Δ argmax |
| `probe` / `unifiedProbed` | 리졸버를 감싸지만 좌표를 안 건드린다(읽기 전용) |
| `placeCorrectStat` | 교정 전후 사본 차이만 인쇄 |
| `adsorbRun` | `unified`를 **스크래치 사본**에 돌린다 — `sim.positions` 무관 |

### §2-3 미분류 (추측 분류 금지 — 다음 판에서 판정)

- **`gateArmed`** — `place`가 세우고 `setAnchorHard`가 내린다. 계기 게이트의
  *시점*을 제어하는 상태인데, 그 게이트(`placementRestGate`)의 작용은 물리다.
  "계기의 시점 제어"가 물리인가 계기인가가 정해져 있지 않다.
- **`adsorbRun`이 건드리는 `resolverMissCount`** — 스크래치 실행이 하네스 전역
  계기 카운터를 증가시킨다. 좌표는 무관하나 계기 값이 실행 횟수에 의존한다.
- **`sim.setCollarRing(ringClosed)`** — 물리 배선이지만 `runDressing` 훅이 아니라
  세션 구성 시점의 호출이다. (c)/(d) 어느 쪽 정의역에도 없었다.

### §2-4 물리인데 이 판에 안 옮긴 것과 사유

- **`place`** — 계기 3종(`placeCorrectStat` 인쇄 · `placementRestGate` 호출 ·
  `gateArmed` 재무장)과 한 몸이다. 계기를 안 지우면서 가르려면 콜백 3개가 필요하고,
  그건 §2-3의 `gateArmed` 판정이 선행돼야 한다.
- **`maxDelta20Mm`** — 값 자체는 3줄인데 그 값을 만드는 루프가 `deltaArg`(argmax
  기록) · `prevFrame` · `bandOf`(대역 라벨)와 같은 순회에 있다. 60회차가 명시적으로
  "**같은 순서**의 병렬 배열"로 설계한 자리라 가르면 계기 정합이 깨진다.

---

## §3 추출된 공개 인터페이스

### `src/lib/garmentFrame.ts`

```ts
createPatternUnifiedResolver(                       // :219
  meshResolver, panelCounts, torsoCapsules, armCapsules,
  opts?: PatternUnifiedOpts,                        // :151
): CollisionResolver
// 기본값 한 곳: torsoCap false(45회차) · armCap true(94회차) ·
//               singleDeepest true(42회차 처방 A) · armMarginM 0.006 ·
//               torsoMarginM COLLISION_MARGIN · torsoPanels [0,1]
// torsoPanels를 인자로 받는 이유: patternGarment를 임포트하면 순환이 된다.

makePatternSessionEnv(o: PatternSessionEnvOpts): GarmentFrameEnv   // :190 / :175
// 담는 것 = 어느 소비자든 같아야 하는 물리 배선:
//   후처리 12종 전량 off · pinCorners false · pinContinuous true ·
//   anchorSyncPrev true · clampInSubstep true / clampAfterPost false ·
//   collisionEvery · maxDisplacement ·
//   마찰 2종의 μ 배분(서브스텝 말미 STATIC/KINETIC ↔ 반복 내 MU_ITER+LOCAL_MU_GAIN)
// 호출자가 넘기는 것: 리졸버 · 자체충돌 · sdfField getter · anchors ·
//   램프 2종의 **초기값** · 계기 훅 2종(probe · onCollarFired)
// 램프 갱신은 기존대로 호출자가 env를 직접 고쳐 쓴다(collarStrainLimit · pinStrength).
```

### `src/lib/sdfCollision.ts`

```ts
bakePatternFrictionSdf(                             // :102
  mesh, skeletonSegments, position, topY, hemY,
  opts?: { skeletonSign?: boolean; padM?: number },
): { field: SdfField; box: PatternSdfBox }          // :98
// 기본값 한 곳: padM 0.08 · skeletonSign false · y 상하한 topY+0.1 / hemY−0.15
// box를 함께 돌려주는 이유: SLEEVESIGN 오라클이 같은 중심을 써야 한다.
```

### `src/lib/patternDressHooks.ts` (신규)

```ts
createAnchorPinRamp(sim, anchors, rampFrames, hooks?): AnchorPinRamp   // :28 / :17
//   { setAnchorHard, rampS(), rampFrame() }
//   hooks.onToggle(hard)   — 계기(결합/해제 1회 인쇄)
//   hooks.onFirstRamp()    — 물리 게이트(핀이 좌표를 쓴 직후)
projectRingTotalLength(sim, ringVertices, currentLenM, maxM): boolean   // :81
//   maxM<=0(RINGTOTAL=0)이면 무동작. 반환 = 발화했는가.
createRingLimitRamp(limit, ringRestM, rampFrames, onClose?): RingLimitRamp  // :115 / :102
//   { update(frame, state, ringLenM) -> 그 프레임 상한, closedAtFrame(), … }
//   조이기 시작 신호는 **상태기계의 S2 진입**만 쓴다(자체 판정식 금지 — 21회차).
```

---

## §4 남은 것 (다음 판)

| | 내용 | 규모(P2a 추정) |
|---|---|---|
| e | `src/workers/patternDressWorker.ts` 신규 — a~d를 부르고 결과 positions를 postMessage | ~120줄 |
| f | `PatternPreview`/`FitCanvas`에 「착장하기」 버튼 + 결과 반영 · `?patternstate=1` 경로 유지 | ~60줄 |
| g | 스크립트 ↔ 브라우저 정합성 대조(§3 표) | — |

추가로 이 판이 남긴 숙제: §2-3 미분류 3건 판정 · §2-4 물리 훅 2건 이사.

**주의(P2a에서 이월)**: `garmentWorker.ts` / `buildGarmentSim.ts` / `clothPhysics.ts`를
만지면 Vite HMR이 기존 Worker 인스턴스를 갱신하지 않는다 → 하드 리프레시로 확인.

---

## §5 기준선 A 상태

**불변.** a~d 어느 단계도 `14e50b8919a63a7f9799220b86e508a9`를 깨지 않았다.
드레이프 캠페인 복귀 시 이 4개 커밋은 물리 무변경으로 취급해도 된다 —
근거는 §1 표와 §1-1의 이분 기록이다.
