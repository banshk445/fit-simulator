# P2a — 브라우저 착장 배선 (A안: 명시적 실행)

> P1이 확정한 최상위 제약 ②「브라우저 v2에 착장 시뮬이 없다」를 푼다.
> **이 문서 시점의 상태: §1 조사 완료 · §2 배선 «미집행» · §3 정합성 «미집행».**
> 이유는 §2 절에 규모와 함께 적었다 — 요약: **복제 0 제약을 지키려면 `dressPattern.ts`
> 추출 리팩터가 선행**하고, 그 크기가 이 판의 착수 전 가정보다 크다.

**스탬프** — HEAD `6edf761` · 브랜치 `v2-stage2a` · 2026-08-10 · **코드 0줄**.
**기준선 A 상태** — `dress-state md5 14e50b8919a63a7f9799220b86e508a9` ·
`patternHash 9f7ba80b3497` · `fixture 9e8b2bf13925`. **이 판에서 깨진 시점 없음**(코드 무변경).

---

## §1 경로 분리 — **Node 전용 의존은 «2개 import»뿐이다**

### 1-1 `scripts/dressPattern.ts`의 Node 전용 의존 전량

| 의존 | 줄 | 쓰이는 곳 | 브라우저 대체 |
|---|---|---|---|
| `node:fs` `readFileSync` | `:11` · `:64` | fixture JSON 읽기 | **이미 대체 경로 있음** — `PatternPreview.tsx:192`가 같은 파일을 `import(...json)`으로 로드한다 |
| `node:fs` `writeFileSync` | `:11` | `public/dress-state.json` 덤프 · `pattern-meta.json` 갱신 | **불요**(브라우저는 결과를 메모리로 넘긴다) |
| `node:fs` `existsSync` | `:11` | 메타 파일 존재 확인 | 불요 |
| `node:crypto` `createHash` | `:12` · `:65` | `fixtureHash` · `patternHash` 스탬프 | 불요(진단용) · 필요하면 `crypto.subtle` |
| `process.env` | 전역 다수 | 스위치 33종(`ENV_KEYS`) | **§1-4에서 처리 방안 확정** |
| `console.*` | 50곳 | 계기 인쇄 | 워커에서도 동작(진단용으로 유지 가능) |

**그 외 import 20여 개는 전부 `src/lib/*`** — 즉 **물리·기하 핵심은 이미 브라우저에서
임포트 가능한 위치에 있다.** 새로 포팅할 물리는 **0줄**이다.

### 1-2 물리·기하 핵심의 위치와 «엉킴» 정도

`dressPattern.ts` 4,262줄 중 `runDressing` 호출은 `:2161`. 그 앞 2,160줄의 구성:

```
주석 552 · console.* 50 · 빈 줄 28 · 나머지 코드 1,530
```

그런데 그 1,530줄의 **대부분이 계기**다(`hemWobble` · `hemReport` · `phaseStat` ·
`betaReport` · `compSequential` · coverage · 자기교차 분해 · 홉 귀속 …).
**물리에 실제로 필요한 호출은 15곳뿐**이고 그것들이 계기 사이에 흩어져 있다:

| # | 줄 | 호출 | 성격 |
|---|---|---|---|
| 1 | `:64-92` | fixture 파싱 → `position` · `torsoIndex` · `wholeIndex` · **`frontIdx`/`backIdx`** · `hemY` · `centerX` · `arms` | **순수 데이터** — `frontIndex`/`backIndex`가 **fixture JSON에 이미 들어 있다**(메시 분할을 브라우저에서 다시 할 필요 없음) |
| 2 | `:192-195` | `outlineTorso`/`outlineWhole` BVH | lib |
| 3 | `:96` | `deriveBodySkeleton` · `measureBody` | lib |
| 4 | `:202` | `makeOutlineProvider` · `buildPatternGarment` | lib · **`PatternPreview`가 이미 같은 호출을 한다** |
| 5 | `:280-282` | `wholeMesh` BVH · `makeParityInside` | lib |
| 6 | `:391` | `correctPlacementPenetration`(S0) | lib |
| 7 | `:528` | `buildPatternSim` | lib |
| 8 | `:772-775` | `frontMesh`/`backMesh` BVH | lib |
| 9 | `:810~830` | **`unified` 리졸버 클로저**(`createPanelSplitResolver` + `buildArmCapsules` + `applyCapsuleCollision`) | **글루 ~20줄 — 추출 대상** |
| 10 | `:874` | `bakeSdf`(bbox 계산 포함 ~25줄) | lib + 글루 |
| 11 | `:977` | `createCachedSdfIterationFriction` | lib |
| 12 | `:1131` | `new SelfCollision` | lib |
| 13 | `:1875~1937` | **session `env` 객체 + `createGarmentSession`** | **글루 ~60줄 — 추출 대상** |
| 14 | `:2146~2160` | **`runDressing` 훅**(`place` · `countPenetrating` · `diverged` · `setAnchorHard` · `maxSeamGapM` · `maxDelta20Mm`) | **글루 ~30줄 — 추출 대상 · 계기 훅과 섞여 있다** |
| 15 | `:2161` | `runDressing` | lib |

⟹ **추출해야 할 «글루»는 대략 150~250줄**이고, 나머지는 전부 계기이거나 이미 lib다.

### 1-3 복제 금지 — **저장소에 이미 선례가 있다**

`src/workers/garmentWorker.ts`(517줄)의 `:151` 주석 원문:

> `createUnifiedResolver`로 **이사(M0)** — 워커는 살아있는 상태 객체만 관리한다.

즉 **v1은 이미 「워커 = 얇은 껍데기 · 글루는 `garmentFrame.ts`로 이사」 구조를 택했다.**
v2도 같은 형태를 따라야 한다 — `unified`/env/훅을 `garmentFrame.ts`(또는 새 `patternSession.ts`)로
이사하고 **`dressPattern.ts`와 워커가 «같은 함수»를 부른다.**

**복제하면 안 되는 이유는 이 저장소에 실증돼 있다** — 92 §4-1이 v1/v2 이중 경로 때문에
처방을 **집행 금지**로 막았다. 세 번째 경로를 만들면 같은 벽이 한 겹 더 생긴다.

### 1-4 env 스위치 처리 방안

`ENV_KEYS` 33종 중 **기본값이 아닌 것으로 돌아야 하는 것은 `RINGTOTAL=0` · `PATTERNCORE=1` 둘뿐**이다
(기준선 A의 실행 줄이 그것이다 · 나머지는 전부 「미설정」).

| 방안 | 내용 | 판단 |
|---|---|---|
| **채택** | 글루 추출 시 **옵션 객체 파라미터**로 받는다(`{ ringTotalMax: 0, armCap: true, … }`). `dressPattern.ts`가 `process.env`를 읽어 그 객체를 만들고, 워커는 **하드코딩된 기본값**으로 같은 객체를 만든다 | 기본값이 한 곳(옵션 타입의 default)에 모이므로 **스크립트와 브라우저가 갈릴 수 없다** |
| 기각 | 워커에서 `process.env` 흉내 | 번들러가 치환하고 기본값이 두 곳에 생긴다 |

**주의**: `RINGTOTAL=0`은 「링 총 길이 상한 = 0 = 미적용」이고 **기준선 A의 조건**이다.
워커 기본값이 이것과 다르면 §3이 갈린다.

---

## §2 배선 — **미집행**

### 왜 이 판에서 안 했는가

§1이 확정한 것: **복제 0을 지키려면 `dressPattern.ts`에서 글루 150~250줄을 lib로 이사시키고
그 파일이 이사한 함수를 부르도록 고쳐야 한다.** 그 리팩터는

- 계기 1,500여 줄이 그 글루의 지역 변수(`g` · `sim` · `frontMesh` · `hemChain` · `total` …)를
  **직접 읽고 있어** 이사 시 컨텍스트 객체로 되돌려 줘야 하고,
- `place`/`setAnchorHard` 훅 안에 **계기가 섞여 있다**(`placeCorrectStat` · `placementRestGate` ·
  `gateArmed`) — 물리 훅과 계기 훅을 갈라야 한다,
- **기준선 A(`dress-state md5`)를 깰 위험**을 직접 안는다.

이 판의 착수 전 가정("기존 Web Worker PBD 경로를 배선한다")은 **v2용 워커가 이미 있다**는
전제였는데, 실제로는 **`garmentWorker.ts`는 v1 전용이고 v2 워커는 존재하지 않는다.**
그래서 「배선」이 아니라 **「추출 + 신규 워커 작성」**이다.

### 집행 계획 (다음 판)

| 단계 | 내용 | 크기 | 검증 |
|---|---|---|---|
| **a** | `unified` 리졸버를 `garmentFrame.ts`로 이사 — `createPatternUnifiedResolver(meshResolver, armCapsules, opts)` | ~30줄 | `dress:pattern` md5 불변 |
| **b** | SDF 굽기 + 마찰 패스 글루를 이사 | ~40줄 | 〃 |
| **c** | session `env` 조립을 이사 — `makePatternSessionEnv(opts)` | ~60줄 | 〃 |
| **d** | `runDressing` 훅을 **물리 훅 / 계기 훅**으로 분리 · 물리 훅만 이사 | ~40줄 | 〃 |
| **e** | `src/workers/patternDressWorker.ts` 신규 — a~d를 부르고 결과 positions를 postMessage | ~120줄 | 콘솔 완료 로그 |
| **f** | `PatternPreview`/`FitCanvas`에 「착장하기」 버튼 + 결과 반영 · `?patternstate=1` 경로 **유지** | ~60줄 | 화면 |
| **g** | §3 정합성 대조 | — | 아래 표 |

**a~d의 각 단계마다 `dress:pattern`을 돌려 md5 불변을 확인**한다 — 깨지면 그 단계에서 멈춘다.

---

## §3 정합성 확인 — **미집행**(§2 선행)

집행 시 채울 표(기준선 A 값은 이미 확보돼 있다):

| 채널 | 스크립트(기준선 A) | 브라우저 | 차 | 비고 |
|---|---|---|---|---|
| cov 몸통(정식·팔 제외) | **6.8%**(118/1728) | — | — | |
| 관통(레이 패리티) | **50 / 5244** | — | — | |
| maxSeamGap | **11.14mm** | — | — | |
| Δ20 | **5.16mm** | — | — | |
| 자기교차(엣지-삼각형) | **1889** | — | — | |
| maxStrain | **2.661**(정점 2146) | — | — | |
| DONE 프레임 | **260** | — | — | |
| 밑단 사슬 합 | **112.57cm** | — | — | |
| 목선 링 | **61.80cm** | — | — | |
| front 캡처 육안 대조 | `docs/captures/2b-107-기준선/front.png` | — | — | |

**비트 동일은 요구하지 않는다.** 크게 갈리면 두 경로가 다른 물리를 도는 것이므로 원인을 찾는다.
갈린 채널과 크기를 표로 남기고 **원인 미상이면 미상으로 적는다.**

---

## 실행 시간 실측

| 경로 | 값 |
|---|---|
| `dress:pattern`(스크립트) | **벽시계 42.1s** · 내부 19.1s · 정착 260프레임 · 물리 73.6ms/프레임 |
| 브라우저 착장 | **미측정**(경로 부재) |

A안은 이 42초를 **사용자가 명시적으로 누른 뒤** 감수하는 설계다. 워커에서 도므로 UI는 얼지 않는다.

---

## 남은 것

| # | 항목 | 자리 |
|---|---|---|
| **P2a-잔여** | §2 a~f 추출·워커·버튼 · §3 정합성 대조 | 위 계획표 |
| P2b | 저품질 프리뷰(C안) · 진행률 · 취소 · 에러 복구 · 절단점 실측 | §2 이후 |
| P2c | ① 품 배선(`patternDraft.ts:231-244`) · ③ `bodySize` 배선(`PatternPreview.tsx:192`) | P1 표 1·3 |
| P2-기타 | ⑤ `wearable` 게이트 v2 적용 · ⑥ 품 폐둘레↔반둘레 규약 통일 | P1 표 5·6 |

**이 판에서 하지 않은 것**(명시): 품 배선 · `bodySize` 배선 · `wearable` 게이트 · 진행률 UI ·
취소 처리 · 저품질 프리뷰 · 절단점 실측 · UI 디자인 · 옷 타입 추가 · 물리 튜닝 —
그리고 **§2 배선과 §3 정합성 자체**.
