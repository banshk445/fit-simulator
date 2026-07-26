# 패턴 재설계 (소매 캡/암홀 형상)

## 배경
`sleeve-redesign-B.md`(독립 소매 패널, 구현 1~6번)는 완료됐고, 남은 문제는
어깨-소매 접합부 톱니였다. 그동안 접근은 봉제선 제약(이즈인/직접스냅) 쪽
튜닝이었다 — 이번 세션에서 그 접근의 한계가 실측으로 드러났다.

## 오늘 실측 (sleeveSeamCheck, chest-width-50.png, 품55cm)

- 어깨 코너(k0/k11, 이즈인 구간): 6.3~7.2mm — 목표(3cm)보다 훨씬 작고 회귀 아님
- **코너 인접 열(k1/k10, 직접스냅 구간)이 코너 자체보다 더 벌어짐**: 14.2~17.7mm
  (left k1=17.7mm k10=14.2mm / right k1=17.2mm k10=6.8mm)
- 즉 톱니의 최대치는 코너(k0/k11)가 아니라 그 바로 옆 — 이즈인을 코너에서
  k1/k10까지 넓혀도 근본 해결이 아닐 가능성 (땜질을 옆으로 옮기는 것뿐)

## 넥라인 시접 — 별개 확인 (같은 세션)
`addNecklineSeamConstraints`(buildGarmentSim.ts:1088)도 `pinCorners`보다
먼저 restLength를 캡처해 코너와 같은 재배치-타이밍 패턴을 갖지만, 몸통 열은
앞/뒤 row0 양쪽이 다 핀 처리되고 `clothPhysics.ts:257`
(`if (pinnedA && pinnedB) continue;`)가 그 제약을 완전히 스킵해 무해함을
코드로 확인함. 넥라인은 이 조사에서 제외.

## 오늘 나온 방향 (가설, 미착수)
k1/k10이 코너보다 더 벌어진다는 건 "제약 강도(이즈인 계수)" 문제가 아니라
**소매 패턴 자체(암홀 곡선 shape, 소매 캡 shape)가 몸판 암홀 곡률과 안 맞는다**는
신호일 수 있다. 다음에 볼 것:
1. k=1, k=10에 대응하는 몸판 암홀 좌표(front row1 / back row1)와 소매 링
   좌표 간 실제 곡률(각 k의 인접 3점 각도) 비교 — 이즈인 계수를 더 만지기
   전에 형상 자체부터 확인
2. `layoutSleevePanel`이 소매 단면을 배치할 때 쓰는 각도 분배(12정점 균등
   분배)가 몸판 암홀의 실제 곡률 분포(코너~겨드랑이 사이 곡률이 균일하지
   않음, sleeve-redesign-B.md 실측 참고)와 맞는지 재검토
3. 필요하면 소매 링 정점 분배를 몸판 암홀 곡률에 맞춰 재표본화(현재는
   "재표본화 불필요"로 결론났던 항목 — 이번 실측으로 재검토 대상)

## 하네스 (scripts/paramSweep.ts)
품×소매통 조합을 자동으로 돌려 관통량/봉제선갭/톱니(seamNormalJaggedness)를
한 번에 표로 뽑는 스크립트 추가(`npm run sweep:pattern`). 공통 톱니 계산은
`src/lib/seamDiagnostics.ts`(`ringJaggedness`)로 빼서 Garment.tsx의
브라우저 디버그(`window.__fitDebug.seamNormalJaggedness()`)와 공유.

## 톱니 지표 시각 검증 완료
품60/소매통18(톱니102°), 품50/소매통22(관통63.69mm), 품65/소매통14
(톱니164.7°) 세 조합을 화면에서 직접 확인 — 지표 순위와 육안 인상
일치. seamNormalJaggedness를 2D 패턴 재설계의 성공 기준으로 채택.

## 다음 세션 시작점: 2D 패턴 재설계 착수
- 소매산 곡선 공식 조사 (표준 패턴 제도법, 암홀 대비 이즈 2~4cm)
- 소매만 먼저 시범 전환 (몸판/목선은 그 다음)
- 성공 판정은 seamNormalJaggedness + 기존 관통/봉제선갭 지표 병행

## 판정 기준
- 성공: seamNormalJaggedness가 지금 베이스라인(armhole ~107~111°,
  sleeve ~77~83°) 대비 확연히 낮아짐(목표: 20° 이내), 기존 관통량/봉제선
  갭 지표에 회귀 없음, tsc 클린, 워커 에러 0
- 위험 신호(작업 멈추고 사용자에게 물어볼 것):
  - 관통량이 기존 대비 증가
  - 몸판(front/back panel) 쪽 코드를 수정해야 하는 상황이 생김
  - 파급 범위가 원래 계획(소매 전용)을 넘어 여러 파일로 번짐
  - 큰 구조 변경(예: 패널 개수, 물리 솔버 자체) 필요성이 보임
- 그 외 조사, 계획 수립, 문서화, 위 기준에 맞는 소매 전용 구현은
  스스로 판단해서 진행. 위험 신호에 걸릴 때만 멈추고 보고.

## 1. 소매산 곡선 표준 공식 (조사)
web search 종합 (출처: [Threads Magazine](https://www.threadsmagazine.com/project-guides/fit-and-sew-tops/on-fitting-sleeves), [Dresspatternmaking](https://dresspatternmaking.com/blog/understanding-the-sleeve-part-3), [Sparrow Refashion](https://sparrowrefashion.com/2024/04/23/basic-sleeve-pattern-drafting-simplified-a-beginners-guide/)):

- **이즈량(암홀 둘레 대비 소매산 둘레)**: 우븐 1.5~2.5cm, 니트 0.5~1.5cm,
  아우터 +3.8~6.4cm(둘레는 bicep 쪽). "핏된 소매"는 3~4.5cm까지도 언급됨.
  우리는 원단 구분 없이 **3cm 고정값**으로 시작(우븐 평균, 중간값) — 원단별
  분기는 나중 항목.
- **소매산 높이**: "삼각형 관계" — 세 변(암홀 둘레, bicep 폭, 캡 높이) 중
  둘을 알면 나머지가 결정됨. 표준 삼각법: `capHeight = sqrt(hyp² - base²)`,
  `hyp = (암홀 둘레 + 이즈량) / 2`, `base = bicep 폭 / 2`. 대략치 공식(더
  단순한 버전)도 있음: `capHeight ≈ 암홀둘레/3 + 여유 1cm`.

## 2. 우리 데이터로 입력값 확보 확인
- **암홀 둘레**: `armholeRingVertices(sim, PANEL_FRONT, PANEL_BACK, col, armholeStartRow)`가
  실좌표 12점을 그대로 반환(buildGarmentSim.ts:890) — 인접점 거리 합(+wrap)으로
  cm 단위 둘레를 바로 계산 가능. **확보됨.**
- **소매통(bicep)**: `sleeveWidthM` 파라미터 — `layoutSleevePanel`에 이미
  들어옴. **확보됨.**
- **소매길이**: `arm.length`(`ArmDir.length`) — 역시 이미 들어옴. **확보됨.**
- 결론: 표준 공식에 필요한 입력 전부 새 계산/새 파라미터 없이 이미
  `layoutSleevePanel` 함수 시그니처 안에서 구할 수 있음 — 함수 밖으로
  나갈 필요 없음(소매 전용 범위 유지에 유리).

## 3. 2D → 3D 매핑 설계
`layoutSleevePanel`(buildGarmentSim.ts:920)은 이미 2D 패턴 개념을 일부
쓰고 있다 — 열(k)은 "둘레 위치"(각도), 행(r)은 "팔 축을 따라 얼마나
갔는지"(reach)로 분리돼 있음. 문제는 각도 공식이
`angle = π/2 - k*(2π/ringCols)`로 **균등 분배**라는 것 — 실제 암홀은
어깨점~겨드랑이 구간 곡률이 균일하지 않은데, 이 균등 각도가 row0(정확히
슬릿 위치, blendT=0)에서 row1로 넘어가는 순간 갑자기 "이상적 균등원"
방향으로 꺾여버려 법선이 급변한다(=톱니, seamNormalJaggedness가 잡는 값).

설계:
- **각도**: `armholeVertex`의 인접 거리 누적합(cm, wrap 포함)으로 각 k의
  호장 비율(`cum[k]/total`)을 구하고, `angle = π/2 - (cum[k]/total)*2π`로
  대체 — 실제 암홀 곡률 분포를 그대로 반영. k=0(어깨점)이 90°인 기존
  관례는 유지.
- **반지름(캡 둘레)**: 지금은 `targetRadius`가 행(r)과 무관하게 상수
  (`computeArmTubeRadius(sleeveWidthM)`) — 암홀 실측 둘레와 무관하게
  사용자가 정한 소매통만 반영해, 이음매 근처에서도 "정상 소매 굵기"를
  요구해 실측 암홀과 어긋날 수 있음. row0 근처(캡 구간)만 표준 공식의
  `capRadius`(암홀 둘레+이즈/2π)를 쓰고, 캡 구간을 벗어나면 기존
  `computeArmTubeRadius(sleeveWidthM)`로 부드럽게 전환.
- **캡 높이 → 램프 길이**: 삼각법으로 구한 `capHeightCm`를 소매길이 대비
  비율로 환산해 "캡 구간이 몇 행까지인지"(`capRampT`)를 정한다 — 지금
  하드코딩된 공유 상수 `ARM_TUBE_RADIUS_RAMP_T`(0.3, 구 플랩과 공유)는
  건드리지 않고, `layoutSleevePanel` 로컬 전용 값을 새로 계산해 쓴다(구
  플랩에 영향 없음 = 몸판/기존 시스템 무변경 유지).
- 이 세 가지 모두 `layoutSleevePanel` 함수 **안에서만** 계산 가능(새 파라미터
  불필요) — 함수 시그니처 불변, 파일 하나(buildGarmentSim.ts) 안에서 끝남.

## 4~5. 시범 구현 + 검증 — 3가지 가설 전부 기각 (실측, 코드 원복)
`layoutSleevePanel`(buildGarmentSim.ts, 소매 전용 함수, 몸판 무변경)에
아래 세 버전을 순서대로 구현·측정. 매번 `npm run sweep:pattern`(Node
하네스) + 브라우저 `seamNormalJaggedness()` 둘 다 확인.

**베이스라인(현재 코드, 회귀 없음 확인용)** — 두 하네스가 서로 다른 수치를
낸다는 것부터 확인해둠(자체충돌/메시충돌 등을 뺀 Node 하네스가 원래
구조적으로 더 나쁘게 나옴, checkSleeveSeam.ts 주석에 이미 문서화된 한계):
- Node(`sweep:pattern`, 대표 포즈 1개): sleeve 102.2~164.7°
- 브라우저(`seamNormalJaggedness`, chest-width-50.png 업로드): sleeve
  77.02~82.76°, armhole 106.88~110.78°

**시도 1 — 각도를 호장 비율로 재배분 + 캡 구간 반지름을 암홀 실측
둘레+이즈로**(문서 "3. 2D→3D 매핑 설계"에 적은 원래 계획 그대로 구현):
- Node: sleeve 109.6~154.6° (베이스라인 대비 대부분 악화, 0.65 조합만 개선)
- **기각.**

**시도 2 — 반지름 롤백, 각도만 호장 비율로(이즈/캡 개념 제거, 각도만
분리 검증)**:
- Node: sleeve 108.4~158.2° — 시도 1보다도 나쁨. 각도 재배분 자체가
  범인임을 확인.
- **기각.**

**시도 3 — 각도를 아예 재배정하지 않음(균등도 호장비율도 아님): 각 k는
center 기준 자기 슬릿 위치의 실제 각도(atan2)를 그대로 쓰고, 반지름만
슬릿 실측값→목표값으로 블렌드(순수 방사형 변형)**:
- Node: sleeve 106.6~155.5° — 여전히 베이스라인보다 나쁨.
- **브라우저(실측)도 확인**: armhole 107.94~113.39°(베이스라인과 비슷,
  회귀 아님 — 예상대로 몸판 쪽은 거의 영향 없음), **sleeve
  132.37~141.28°(베이스라인 77~83°보다 뚜렷이 악화)**.
- **기각.**

**결론**: 세 가설(균등 각도가 문제 / 호장비율로 고치면 됨 / 각도 재배정
자체를 없애면 됨) 전부 실측에서 베이스라인보다 나빠졌다 — "각도를 어떻게
배분하는가"는 톱니의 진짜 원인이 아니었거나, 최소한 이 세 가지 변형으로는
못 잡았다. 관통량/봉제선갭은 세 시도 모두 회귀 없음(위험 신호 아님) —
잡힌 건 목표 지표(jaggedness)뿐이라 "위험 신호"에는 안 걸렸지만 성공
기준(20° 이내, 개선)에는 전혀 못 미쳤다. **`layoutSleevePanel` 코드는
원래대로 원복함(git checkout) — 커밋 안 함.**

## 다음 가설 (미착수, 다음 세션 시작점)
세 시도 모두 "row0(슬릿, 정확)에서 row1로 넘어가는 순간 각도를 강제로
바꾼다"는 공통점이 있었다(시도3도 반지름만 바꾼다지만 각도를 atan2로
고정한 것 자체가 여전히 "재계산"이지, row0→row1 사이 실제 이웃 정점과의
상대 곡률 연속성을 보장하진 못함). 다음에 볼 것:
1. row0 자체의 곡률(인접 k끼리의 실제 각도 변화율, 이미 doc 초반의
   "겨드랑이 5.54cm vs 어깨 0.20cm" 실측이 이 곡률이 극단적으로 불균일함을
   보여줌)을 row1이 그대로 이어받는 "탄젠트 매칭"(에르미트 블렌드류) 시도 —
   position만 맞추는 lerp가 아니라 derivative(방향)도 row0에서 맞추기.
   지금 세 실패 시도는 전부 "position은 lerp, 각도/반지름 목표는 새로
   계산"이라 derivative 불연속이 여전히 남아있었을 가능성이 큼.
2. seamNormalJaggedness 자체가 재는 게 "row0→row1 사이 법선"인지 다시
   확인 — computeVertexNormals()가 row0 법선을 계산할 때 실제로 어떤
   이웃(row1만? row1+col 이웃까지?)을 쓰는지 정확히 짚고 나서 접근할 것.
3. 이번 세션 다 실패한 세 변형(각도 재배분류) 방향은 재시도하지 말 것 —
   시간 낭비 확인됨.

## 미착수
2D 패턴 재설계 자체는 미착수(세 시도 전부 원복). 하네스/진단 스크립트
(seamDiagnostics.ts, paramSweep.ts + armhole/sleeve 분리 컬럼)는 남겨둠.
