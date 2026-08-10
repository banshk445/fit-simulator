# P7-scope — 옷 타입 추가 범위 조사

**코드 0줄.** 기준선 A/B 불변(코드를 안 건드렸다). 브라우저 실행은 조사 수단으로만 썼다.

## 판정 (§3)

**새 «타입» 추가(셔츠·바지)는 둘 다 P2급 이상이다 ⟹ ㄷ(옷 타입)를 뒤로 미루고
ㄴ(핏 리포트)으로 간다.** 미루는 것이지 버리는 것이 아니다 — 근거는 §2다.

**단, 긴팔은 이미 된다**(§2-1 실측). 그래서 「가장 작은 후보」는 착수 대상이 아니라
**마감 대상**이고, 그 마감(커프 + 전완 콜라이더)은 반나절~P4급으로 언제든 끼워 넣을 수 있다.

---

## §1 재사용 / 티셔츠 전용 경계

### 타입 독립 (재사용 가능)

| 자리 | 근거 |
|---|---|
| `patternDraft.ts:126-200` 곡선 기계 | `evalCurve` · `arcTable` · `curveLength` · `sampleArcEqual` · `sampleBySizeField` — 세그먼트/곡선 표현 자체는 의류 무관 |
| `patternDraft.ts:74-101` 자료형 | `PatternSegment` · `PatternPanel`(닫힌 루프 + 미러축 여부) · `SeamSpec`(a/b 세그먼트 짝) — **모델은 일반적**이다 |
| `patternGarment.ts:130-290` 삼각화·조립 | `buildSizeField` → `triangulatePanel` → 패널별 오프셋 병합 → `edgePairs` · 시접 쌍 생성. 패널 «개수»에만 의존하고 «의미»에는 무관 |
| `buildPatternSim.ts` | `panelStarts.length`를 순회한다(:102) — 패널 수 일반 |
| `garmentFrame.ts:125·235` | `panelCounts.length` 순회 — 패널 수 일반 |
| `patternDressCore` 단계 골격 | body → garment → mesh → place → sim → collide → anchors → session → run. **순서 자체는 타입 무관** |
| `dressingMachine.runDressing` | S0~S3 상태기계 · 시접 rest 램프 — 시접이 있으면 성립 |
| 마찰 SDF · 자체충돌 · 배치 교정 | 몸 메시와 옷 메시만 본다 |

### 티셔츠 전용 (타입마다 새로 필요)

| 자리 | 무엇이 박혀 있나 |
|---|---|
| `patternDraft.ts:85` | `PanelName = "front" \| "back" \| "sleeve"` — **3종 고정** |
| `patternDraft.ts:95-101` | `SeamSpec.kind = shoulder \| side \| armhole \| sleeveUnder` — **4종 고정** |
| `patternDraft.ts:221` | `draftTshirtPattern(body, g)` — 함수 하나가 티셔츠 제도 전체 |
| `patternDraft.ts:47-49` | 진동깊이 `chestGirthM/4 + 0.030` — 티셔츠 여유 |
| `patternDraft.ts:231-244` | 몸판 반폭 = `widthM/2`(P3) — 몸판 2매 전제 |
| `patternDraft.ts:246-300` | 목선(4분 타원 · 앞뒤 깊이 · 이분법으로 목너비) — **목이 있는 옷** 전제 |
| `patternDraft.ts:362-440` | 소매산 "walking the sleeve" · `underSleeveM = sleeveLengthM − capHeightM` — **직선 원통 소매** |
| `patternGarment.ts:39-43` | `PANEL_PAT_FRONT/BACK/SLEEVE_L/SLEEVE_R = 0/1/2/3` — **4패널 고정** |
| `patternGarment.ts:208-224` | `draft.panels[0]/[1]/[2]` 직접 색인 + 소매 미러 복제 → `panelCounts` 4개 |
| `patternGarment.ts:265-272` | `mirrorOf` — 앞/뒤는 자기 미러, 소매는 2↔3 짝 |
| `patternGarment.ts:293-296` | `meshOf`/`directPanel`이 3 이름을 4 패널에 매핑 |
| `patternGarment.ts:~440-490` | `mapTorso` — 어깨 능선(`ridgeAnchorY`) 기준 평면 2매 배치 |
| `patternGarment.ts:494-521` | 소매 배치 — `arm.dir` **직선 축** 둘레 원통 감기 |
| `patternGarment.ts` `necklineRing` · `shoulderPairs` | 목선 링·어깨 시접 — 티셔츠 위상 |
| `patternDressCore.ts:409·580·766·792` | `panelStarts[2]` = **몸판/소매 경계**(hemBend 대역 · 34게이트 몸판·소매 분리 · 밑단 사슬 · 밑단 앞/뒤 분해) |
| `patternDressCore.ts:486` | `torsoPanels: [PANEL_PAT_FRONT, PANEL_PAT_BACK]` |
| `patternDressCore.ts` `anchorList` | 앵커 = **어깨 능선** 호장 매핑(`body.ridgePoints`) — 어깨로 매다는 옷 전제 |
| `patternDressCore.ts` `sim.setCollarRing` | 목선 링 원주 제약 |
| `garmentFrame.createPatternUnifiedResolver` | 리졸버 배열 `[front, back, null, null]` — **4칸 고정**(`patternDressCore.ts:479-485`) |
| `checkPattern.ts:148·217·229·342·353-356·430` | 「앞판/뒤판/소매L/소매R」 이름 · `p=3..0` 역순 색인 · 코너 8개 일치 · 미러 쌍 검사 |
| `garmentFitLimits` | 가슴둘레 ↔ 품 판정 — 상의 전제 |
| `bodyMeasure` | 제공: 가슴·목·목밑·어깨통과·능선. **허리는 있으나**(`waistGirthM`) 밑위·인심·엉덩이는 **없다** |
| 충돌자 | 몸통 캡슐 + **팔 캡슐 2개/팔**. **다리 콜라이더는 없다** |

---

## §2 후보별 크기

### §2-1 긴팔 — **이미 된다** (실측)

`?patterncore=1&ringtotal=0` · 「긴팔」 토글 + 착장:

```
DONE f=260 · 벽시계 16.8s · 소매길이 58cm
cov 5.7% (100/1744) · maxStrain 2.666(정점 3247) · maxSeamGap 9.58mm · Δ20 5.52mm ·
자기교차 2159 · 관통 103/6642 · 목선 링 61.80cm · 밑단 합 114.05cm
```

기준선 B(반팔) 대비: 정점 5,244 → **6,642**, 관통 49 → **103**, 자기교차 2143 → 2159.
화면은 소매가 손목까지 내려온다 → `docs/captures/P7-scope/긴팔-이미-된다.jpg`

**되는 이유**: 제도가 `underSleeveM = sleeveLengthM − capHeightM`로 원통을 길게 뽑고,
`computeArmShapes`가 긴팔일 때 `findArmDirection`(어깨→손)을 쓰며, 배치가 그 축 둘레로 감는다.

**미흡한 점 2가지(코드 근거)**:
1. **커프가 없다** — 소맷부리가 열린 원통 그대로다. 화면에서 손등 근처가 벌어진다.
   `SeamSpec.kind`에 cuff가 없고 제도에도 커프 세그먼트가 없다.
2. **전완 콜라이더가 없다** — `buildArmCapsules`(`garmentFrame.ts:79-96`)는 캡슐 2개를
   **같은 직선 `dir`** 위에 놓는다(0~0.55L · 0.55L~1.25L). 팔꿈치 굽음을 따르지 않는다.
   관통이 49→103으로 2배가 된 자리가 여기로 보인다(귀속은 미실측).

**크기: 반나절~P4급** — 커프 세그먼트 + `kind` 1종 추가, 또는 콜라이더를 팔꿈치에서 꺾기.
**새 타입이 아니라 기존 타입의 마감**이다.

### §2-2 셔츠 — **P2급**

새로 필요한 것:
- **패널 3매 이상**: 앞여밈이면 앞판이 좌/우로 갈린다 ⟹ `PanelName` 확장 ·
  `PANEL_PAT_*` 상수 재편 · `panelCounts` 4 → 5~7 · `directPanel`/`meshOf` 재작성
- **미러 전제 해체**: 앞판은 지금 `halfWithMirrorAxis: true`(절반 + 미러)다. 앞여밈은
  좌우가 **비대칭**(단추 여밈분)이라 `mirrorOf`(`patternGarment.ts:265-272`)와
  `check:pattern`의 미러 쌍 검사가 그대로 안 선다
- **시접 종류 3종 추가**: placket · collar · cuff ⟹ `SeamSpec.kind` 확장 + 시접 테이블
- **칼라** = 목선에 붙는 별도 패널. 지금 목선은 `necklineRing` + `setCollarRing`(원주 제약)로
  **닫힌 고리**를 전제한다 — 앞여밈이면 고리가 **열린다**. 링 기계의 전제가 깨진다
- **배치**: `mapTorso`가 앞판을 한 장의 평면으로 놓는다. 좌우 앞판을 따로 놓고 여밈에서
  겹치게 해야 하며, 겹침은 지금 게이트가 **자기충돌/관통으로 잡는다**
- **`panelStarts[2]` 관례 붕괴**: 몸판/소매 경계가 2가 아니게 된다 ⟹
  `patternDressCore` 4자리(:409 :580 :766 :792) + 리졸버 배열(:479-485) 재설계
- **게이트 재작성**: `check:pattern`의 패널 이름·색인·코너 8개·미러 검사

⟹ 제도 신규 + 위상(열린 목선) + 배치 + 게이트. **P2급**(P2b~P2d에 맞먹는다).

### §2-3 바지 — **P2급 이상**

셔츠의 항목 대부분에 더해:
- **몸 대역이 다르다**: 현재 옷이 덮는 y는 78~143cm(상체). 바지는 허리~발목이다
- **매다는 방식이 없다**: 착장 앵커는 `body.ridgePoints`(**어깨 능선**) 호장 매핑이다.
  바지는 허리로 걸린다 ⟹ 앵커 층 신규(허리밴드 제약 = `setCollarRing`의 유사물이나
  도출은 전부 새것)
- **몸 실측 부재**: `bodyMeasure`는 허리둘레는 주지만(`waistGirthM`) **밑위·인심·엉덩이
  둘레·다리 축이 없다**. 제도의 입력 자체가 없다
- **다리 콜라이더 부재**: 몸통 캡슐 + 팔 캡슐뿐이다. 다리 2개에 대한 캡슐·SDF 대역이 없고,
  `splitFrontBack`/`excludeArms`(`meshCollision.ts`)는 **토르소 전용** 분할이다
- **두 다리 = 두 축**: 소매 배치가 팔 축 원통이듯 다리도 축 원통이 필요한데, 팔과 달리
  **가랑이에서 두 축이 만난다**(밑위) — 지금 어느 배치 사상에도 없는 위상
- `garmentFitLimits`(가슴↔품)가 하의에 무의미 ⟹ 게이트 신규

⟹ **P2급 이상.** 제도·몸 실측·콜라이더·앵커·배치 위상이 전부 새것이다.

---

## §3 판정 근거 정리

| 후보 | 크기 | 성격 |
|---|---|---|
| 긴팔 | 반나절~P4급 | **이미 됨** · 마감(커프 · 전완 콜라이더)만 남음 |
| 셔츠 | **P2급** | 제도 + 열린 목선 위상 + 배치 + 게이트 재작성 |
| 바지 | **P2급 이상** | 위 전부 + 몸 실측·콜라이더·앵커 층 신규 |

프롬프트 판정 규칙 적용:
- 「가장 작은 후보가 P4급 이하면 착수」 — 긴팔이 그 자리인데 **이미 되므로 착수 대상이 아니다**.
- 새 타입 후보(셔츠·바지)는 **전부 P2급 이상** ⟹ **ㄷ를 미루고 ㄴ(핏 리포트)으로 간다.**

**미루는 이유를 한 줄로**: 타입 추가의 비용은 제도가 아니라 **위상**에 있다 —
지금 파이프라인은 「닫힌 목선 고리 + 어깨로 매달림 + 몸판 2매/소매 2매 + `panelStarts[2]`
경계」를 **여러 층에 걸쳐** 전제하고 있고, 셔츠·바지는 그 전제를 각각 다른 방식으로 깬다.

## §4 다음 판을 위한 메모 (ㄷ 재개 시)

1. **선행 리팩터가 실질 비용의 절반**이다: `PanelName`/`SeamSpec.kind` 확장,
   `panelStarts[2]` 경계를 「몸판 집합/소매 집합」 같은 **명시적 집합**으로 바꾸기,
   리졸버 배열 고정 4칸 해체. 이건 **타입과 무관하게** 먼저 해도 되고, 하면 P2d처럼
   md5+로그 게이트로 항등 검증이 가능하다.
2. 셔츠를 먼저 하는 편이 낫다 — 몸 실측·콜라이더는 그대로 쓸 수 있다(상의).
3. 긴팔 마감은 언제든 독립적으로 끼워 넣을 수 있다.
