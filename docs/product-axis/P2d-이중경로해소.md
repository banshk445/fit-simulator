# P2d — 스크립트를 코어 위로 (이중 경로 해소)

**기점**: `51e4486` (P2c) · **종점**: 아래 §2 표
**기준선 A**: dress-state md5 `14e50b8919a63a7f9799220b86e508a9` — **불변**.

## 결론

`scripts/dressPattern.ts`에 **물리 호출이 한 줄도 남지 않았다.** 순서는
`src/lib/patternDressCore.ts` 한 벌뿐이다. 하네스는 8단계를 부르고 그 «사이»에
계기를 넣으며, 계기는 전부 불투명 콜백(`PatternDressObservers`)으로만 들어간다 —
코어는 계기가 무엇을 하는지 모르고, 브라우저는 옵저버를 하나도 넘기지 않는다.

**검증은 md5 하나가 아니다.** 이번 판은 **실행 로그 938줄 전량 diff**를 게이트로
세웠다(계기 50여 종의 인쇄가 전부 그 안에 있다 — md5는 최종 좌표만 덮는다).
두 env × 두 묶음 × 최종 확인 전부 **diff 0줄**이다.

---

## §0 로그 diff 하네스 (이번 판의 주 게이트)

md5는 최종 좌표만 덮는다. 계기를 옮기다 인쇄가 하나 빠지거나 값이 바뀌어도 md5는
통과한다 — 실제로 이번 판에서 그런 실패가 **2건** 났고 둘 다 로그 diff가 잡았다.

```
python3 norm.py <로그> > <정규화>      # 경과 시간류만 마스킹(elapsedMs · ms/프레임 · 경과 s)
diff base.norm cur.norm               # 0줄이어야 통과
```

정규화 대상은 **시간뿐**이다. 같은 커밋 2회 실행으로 diff 0줄을 먼저 확인해
하네스 자체를 검증했다(그 검증에서 `물리 73.x ms/프레임` 마스킹 누락 1건을 고쳤다).

---

## §1 계기 삽입점 지도

코어 단계(굵게)와 그 사이에 끼는 계기. 「읽는 것」은 단계 반환값이다.

| # | 코어 단계 | 그 뒤에 오는 계기(하네스) | 읽는 것 |
|---|---|---|---|
| 1 | **`body()`** 골격·측정 | 정본 몸 반경 프로파일 v1(42회차) · 39/40/41 인용 대조 | `position` `skeleton` `body` |
| 2 | **`garment()`** 제도·삼각화·배치 | patternHash/meta 산출·EXPORT_META · 환경 스탬프 · env 줄 · 패널 정점 인쇄 | `g` `total` `garmentDims` |
| 3 | **`mesh()`** 몸 BVH·패리티·skipKeys | `WINDING=1` 와인딩 실측 · 수밀성(countOpenEdges) | `wholeMesh` `insideParity` `skipKeys` |
| — | (`margins()`) | margin 채널 줄 · 폭 채널 줄(105 §2) | `MESH_MARGIN` `PLACE_MARGIN` |
| 4 | **`place()`** S0 배치 교정 | **`placeCorrectStat`가 교정 호출을 감싼다**(옵저버) · S0 관통 인쇄 · t=0 게이트 6종 · t=0 자기교차 | `penBefore` `corrected` `penAfter` |
| 5 | **`sim()`** 시뮬 조립·링 폐곡선·rest | 제약 수 인쇄 · 링 폐곡선 배선 검증(차수 2·단일 순환) · 38계기C rest 3종 · 링 총길이 상한 인쇄 · 넥밴드 원주 인쇄 | `sim` `ringClosed` `ringLenM` `ringRestM` `ringTotalMaxM` |
| 6 | **`collide()`** BVH·리졸버·SDF·자체충돌 | SDF 굽기 인쇄(호출을 감싸 경과 측정) · `SLEEVESIGN=1` 부호 오라클 · 흡착 프로브(`adsorbRun`) | `unified` `sdfField` `sdfBox` |
| 7 | **`anchors()`** 앵커 목표·34게이트 | 앵커 배선 검증 4종(제외검증·능선 여유·간격 단조·표면 이탈) | `anchorList` |
| 8 | **`session()`** env·세션·램프 2종·전이 술어 | 41종 계기 정의(restMap · 홉 귀속 · 대역 · 자기교차 분해 …) | `env` `session` `anchorRamp` `ringRamp` `maxSeamGapM` `maxDelta20Mm` `diverged` `frameLayout` `framePose` |
| 9 | **`run()`** 상태기계 | 옵저버 9종(아래) | `result` |
| — | **`metrics()`** | (브라우저 전용 — 하네스는 자기 계기를 쓴다) | — |

### 옵저버 = 계기가 물리 «안»에 끼는 지점

| 옵저버 | 시점 | 하네스가 하는 일 |
|---|---|---|
| `wrapPlaceCorrect` | 배치 교정 호출을 감쌈 | 106 §3 변위 계기(전후 사본 차이) |
| `wrapResolver` | 충돌 리졸버를 감쌈 | 31계기 패스 경계 프로브 2회 |
| `probe` | 서브스텝 패스 경계 | 링/접합 길이 스냅샷 |
| `onRestGate` | 34게이트 계산 «후» · throw «전» | 두 줄 인쇄(위반해도 먼저 찍힌다) |
| `onAnchorToggle` | 하드 핀 결합/해제 1회 | `[dress] 앵커 …` |
| `onRingClose` | S2 진입 | `[링·시점분리]` |
| `onRingLimit` | 링 상한 갱신 직후 | `ringLimitNow` 미러(전이·diag 인쇄가 인용) |
| `onAnchorStrength` | 강도 스케줄 | `anchorStrength` 미러 |
| `beforeStep` | step 직전 · 링 램프 «전» | 프로브 무장 · 38/39/35/31계기 |
| `onFrameBeforeProject` | onFrame 전반 · **투영 전** | 패스별 분해 · 축소 잔여 일량(투영 전 값이어야 한다) |
| `onFrameAfterProject` | 투영 후 · Δ 기록 전 | 링 y 시계열 · 하중 배분 · 전이 근방 · 봉합 닫힘 |
| `onDelta` | Δ 기록 시 | 60계기 argmax(`deltaArg`) |
| `stateNote` | 전이 로그 한 줄 | 링상한·앵커강도 병기 |

**옵저버는 지연 위임한다** — 코어는 `obs.x`를 호출 시점에 읽고, 구성 시점에 값으로
포획하지 않는다. 하네스가 세션 조립 «뒤»에 콜백을 붙일 수 있어야 하기 때문이다
(1차 시도에서 `onAnchorToggle`을 포획해 인쇄 2줄이 사라졌다 — §2-1).

---

## §2 묶음별 커밋과 게이트

| 묶음 | 커밋 | 옮긴 단계 | `RINGTOTAL=0` md5 / 로그 diff | 기본 env md5 / 로그 diff |
|---|---|---|---|---|
| 1 | `aa85f5b` | body · garment · margins · mesh · place · sim | `14e50b89…` / **0줄** | `a20ff9e3…` / **0줄** |
| 2 | `4e7db1a` | collide · anchors · session · **run** | `14e50b89…` / **0줄** | `a20ff9e3…` / **0줄** |
| 3 | (아래) | 죽은 지역 변수 제거 + 문서 | `14e50b89…` / **0줄** | `a20ff9e3…` / **0줄** |

9채널은 로그 diff 0줄에 포함된다(cov 6.8% · maxStrain 2.661 · maxSeamGap 11.14 ·
Δ20 5.16 · 자기교차 1889 · 관통 50/5244 · DONE f=260 · 밑단 112.57 · 링 61.80).
`patternHash 9f7ba80b3497` · `fixture 9e8b2bf13925` 불변.
`npx tsc -b` · `npm run build` 매 묶음 통과.

### §2-1 묶음2가 단독으로 설 수 없었다 (정지·이분 기록)

계획은 「collide·session」과 「run」을 따로 떼는 것이었다. **불가능했다.**

- 정착 판정 `maxDelta20Mm`는 코어 소유(전이 술어)인데, 그 원자료 `deltaHist`를
  채우는 루프는 하네스의 `onFrame` 계기 뭉치 «안»에 있었다.
- 가르면 코어의 `deltaHist`가 영원히 비어 `Δ20 = Infinity` → S3가 정착하지 못하고
  RETRY 1 → **ABORT**. 실측 md5 `0a638ce695607fd455352d0302d1ec75`, 로그 diff 447줄.
- 규칙대로 그 자리에서 멈추고 **env 줄부터 확인**(P2b (b) 재발 방지 — `RINGTOTAL=0`
  포함 확인)한 뒤 코드 원인을 특정했다. env는 정상이었고 원인은 위 배선이다.
- 조치: 실행 훅을 같은 묶음으로 합쳤다. **묶음을 늘리는 것이 아니라 줄이는 방향의
  정정**이고, 그렇게 해야 「정착 판정과 그 원자료」가 한 커밋 안에 있다.

### §2-2 두 번째 실패 — md5는 통과하고 로그가 걸렸다 (2건)

| 증상 | md5 | 로그 diff | 원인 |
|---|---|---|---|
| `[dress] 앵커 …` 2줄 소실 | **통과** | 4줄 | `onAnchorToggle`을 세션 조립 시점에 값으로 포획 → 하네스가 뒤에 붙인 콜백이 안 보였다. 조치: 지연 위임 |
| `링 총 길이 상한 발화: 0회` | **통과** | 4줄 | 투영이 코어로 갔는데 카운터는 하네스 지역 변수였다. 조치: `dressing.ringTotalFired()` |

**md5만 봤으면 둘 다 통과로 넘어갔다.** 로그 전량 diff를 게이트로 세운 것이 이번 판의
실질적 산출물이다.

---

## §3 완료 확인

### 이중 경로 0

`dressPattern.ts`에서 물리 호출 심볼 전량을 grep한 결과 **코드 히트 0건**이다
(남은 히트는 전부 주석·문자열). 대상: `buildPatternGarment` `buildPatternSim`
`correctPlacementPenetration` `makeParityInside` `createPanelSplitResolver`
`createPatternUnifiedResolver` `bakePatternFrictionSdf` `makePatternSessionEnv`
`createGarmentSession` `runDressing` `createAnchorPinRamp` `createRingLimitRamp`
`projectRingTotalLength` `new SelfCollision` `setCollarRing` `deriveBodySkeleton`
`measureBody` `new ArrayBvhCollision` `buildArmCapsules` `makeOutlineProvider`.

`dressPattern.ts` 4,393 → **3,905줄**(−488). `patternDressCore.ts` 468 → **829줄**.

### 브라우저 §g 재확인 (코어를 고쳤으므로 다시 잰다)

| 채널 | 스크립트 | 브라우저 | 차 |
|---|---|---|---|
| **`RINGTOTAL=0` / `?ringtotal=0`** | | | |
| cov 몸통 | 6.8% (118/1728) | 6.8% (118/1728) | 0 |
| maxStrain | 2.661 (정점 2146) | 2.661 (정점 2146) | 0 |
| maxSeamGap · Δ20 | 11.14mm · 5.16mm | 11.14mm · 5.16mm | 0 |
| 자기교차 · 관통 | 1889 · 50/5244 | 1889 · 50/5244 | 0 |
| 종료 · 밑단 합 · 링 | DONE f=260 · 112.57cm · 61.80cm | 동일 | 0 |
| **기본 env / `?patterncore=1`** | | | |
| cov 몸통 | 6.9% (119/1728) | 6.9% (119/1728) | 0 |
| maxStrain | 2.463 (정점 2146) | 2.463 (정점 2146) | 0 |
| maxSeamGap · Δ20 | 11.20mm · 5.25mm | 11.20mm · 5.25mm | 0 |
| 자기교차 · 관통 | 1917 · 51/5244 | 1917 · 51/5244 | 0 |
| 종료 · 밑단 합 · 링 | DONE f=260 · 112.28cm · 54.05cm | 동일 | 0 |

워커 벽시계 35.6s(RINGTOTAL=0) · 62.5s(기본) — 부하 의존이라 단일 측정으로 예산을
판정하지 않는다.

### v1 경로

`garmentWorker.ts` · `spikeDressing.ts` · `paramSweep.ts` · `buildGarmentSim.ts` ·
`clothPhysics.ts` **수정 0줄**. 이번 판이 닫은 것은 v2 안의 이중성이다.

---

## §4 코어 인터페이스 최종형

```ts
createPatternDressing(fixture, opts?, obs?) → {
  opts,                       // 해소된 물리 스위치(기본 = 하네스의 env 미설정)
  body() garment() margins() mesh() place() sim() collide() anchors() session()
  run() metrics() ringTotalFired() frames t0
}
runPatternDressing(fixture, opts?) → PatternDressResult   // 브라우저·워커(옵저버 0)
```

각 단계는 **한 번만 돌고**(메모) 앞 단계를 스스로 부른다 — 호출자가 순서를 재정의할
수 없다. `margins()`와 `mesh()`가 따로 있는 이유는 배치 교정 «전»에 인쇄하는 계기가
있어서다(margin 채널 줄 · 폭 채널 줄 · WINDING · 수밀성).

**옵션 = env 채널.** `ringTotal`(기본 true) · `marginAllM` · `meshMarginM`(`"self"`는
값이 아니라 도출) · `placeMarginM` · `torsoCap`(false) · `armCap`(true) ·
`singleDeepest`(true) · `s0fix`(true) · `skeletonSign`(false) · `pinDress`(false) ·
`seconds`(25) · `penetrationAxis` · `magnet` · `hemBend{raw,bandM}` · `garmentDims` ·
`onProgress`. 하네스는 `DRESS_OPTS` 한 곳에서 env를 파싱하고, 파일 곳곳의 상수는
그 값을 **별칭**으로 받는다(주석·인쇄는 원래 자리 유지).

---

## §5 부작용이 있어 «물리»로 재분류한 계기

| 항목 | 이전 분류 | 판정 | 근거 |
|---|---|---|---|
| Δ 기록 루프(`deltaHist` 적재) | 계기(onFrame 뭉치 안) | **물리** | 정착 판정 `maxDelta20Mm`의 유일한 원자료다. 떼면 S3가 정착하지 못한다(§2-1 실측 ABORT) |
| `ringLimitNow` 대입 | 계기(beforeStep 끝) | **물리** | `env.collarStrainLimit` 갱신 = 프레임마다 제약 상한을 바꾼다. 하네스에는 인쇄용 미러만 남았다 |
| `ringTotalFired` 카운터 | 계기 | **계기**(단 소유가 코어) | 세는 대상(투영)이 물리라 코어가 세고 하네스가 읽는다 |
| `rampSeams`(= `g.seams`) | — | **물리** | S1 램프 대상 집합. 코어로 |
| `gravity` · `frameLayout` · `framePose` · `FRAMES` | — | **물리** | step 인자·프레임 예산. 코어로(단 정착 후 ablation 계기가 같은 값을 써야 해서 `session()`이 노출한다) |

P2b §2-3의 미분류 3건은 P2c에서 이미 갈렸고(`gateArmed`=물리 · `resolverMissCount`=계기 ·
`sim.setCollarRing`=물리) 이번 판에서 그대로 배선됐다. **새 미분류 0건.**

---

## §6 남은 이중성

**없다.** 물리 호출 순서는 코어 한 벌이고 하네스·워커가 같은 함수를 부른다.

남은 것은 이중성이 아니라 미착수 항목이다:

| | 내용 |
|---|---|
| P2e-1 | 워커 재실행 경쟁·취소·진행률 UI·에러 복구(P2c §f 이월 + 겹침 관측 1건) |
| P2e-2 | 품 배선 · bodySize 배선 · wearable 게이트(P1/P2a 이월) |
| 정리(별건) | `dressPattern.ts`에 P2b(a)/(b) 이사 주석이 코드 없이 남았다. 회차 이력이라 이번 판에서 지우지 않았다(「하는 김에 정리」 금지) |

## §7 기준선 A 상태

**불변.** `14e50b8919a63a7f9799220b86e508a9` — 최종 확인 실행으로 복원해 두었다.
기본 env 값 `a20ff9e3091ed3017d68686b2e665a7c`도 불변.
드레이프 캠페인 복귀 시 P2b~P2d 커밋은 **물리 무변경**으로 취급해도 된다 —
근거는 §2 표(md5 2종 + 로그 938줄 전량 diff 0줄)다.
