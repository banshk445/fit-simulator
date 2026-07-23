import { ClothSimulation } from "./clothPhysics";

// 46번(전면 재설계 — 통합 단일 패널): 소매가 더 이상 별도 패널이 아니라
// 몸판(앞/뒤) 자체의 넓은 바깥쪽 열이므로, 예전에 여기 있던
// addArmholeSeamConstraints(몸판 경계와 소매 링을 잇던 재봉 제약)는 통째로
// 필요 없어졌다 — 같은 격자라 이음매 자체가 존재하지 않는다.

// 34번: 사용자가 제공한 실제 옷 사진으로 재현해보니, 대칭인 핀(어깨 좌우
// X좌표가 소수점 넷째 자리까지 일치 — 11번 항목에서 이미 실측)에서
// 시작해도 밑단(마지막 행)의 실제 좌표는 한쪽이 다른 쪽보다 수 cm 더
// 내려오는 뚜렷한 비대칭으로 수렴했다(정점 좌표 실측: 열 간격 자체도
// 좌우가 안 맞았음). 11번에서 이미 진단한 것과 같은 계열의 문제 —
// 가우스-자이델 완화는 대칭 입력에서도 대칭인 해로 수렴한다는 보장이
// 없다(부동소수점 연산 순서, 충돌 스냅 타이밍 등 미세한 비대칭이 반복을
// 거치며 증폭될 수 있음). 그때는 안전 마진(SHOULDER_PIN_OUTSET 확대)으로
// 우회했지만, 이번엔 문제가 옷 전체(밑단까지)에 걸쳐 훨씬 크게 나타나
// 마진만으로 가릴 수 있는 수준이 아니다 — 매 프레임 마지막에 각 열을
// 대칭축(X=0) 기준 반대쪽 열과 부분적으로(SYMMETRY_BLEND) 블렌딩해
// 대칭을 사후 보정한다. 완전히 스냅(1.0)하지 않고 부분 블렌드로 두는
// 이유는 pullShoulderCapToSurface 등 다른 프레임당-1회 보정과 같은
// 이유다(완전 스냅은 자연스러운 미세 드레이프 차이까지 지워 뻣뻣해
// 보일 수 있고, 매 프레임 재적용되는 값은 weight와 무관하게 결국
// 같은 대칭 해로 수렴하므로 굳이 1.0일 필요도 없다).
const SYMMETRY_BLEND = 0.5;

export function enforceLeftRightSymmetry(
  sim: ClothSimulation,
  frontPanel: number,
  backPanel: number,
  cols: number,
  rows: number,
): void {
  const half = Math.floor(cols / 2);
  for (const panel of [frontPanel, backPanel]) {
    for (let y = 1; y < rows; y++) {
      for (let x = 0; x < half; x++) {
        const xMirror = cols - 1 - x;
        const i = sim.index(panel, x, y);
        const j = sim.index(panel, xMirror, y);
        const iPinned = sim.pinned[i];
        const jPinned = sim.pinned[j];
        if (iPinned && jPinned) continue;
        const ix = i * 3;
        const jx = j * 3;
        // x열은 항상 +X쪽(pinLeft 방향), xMirror열은 항상 -X쪽(pinRight
        // 방향)이라는 pinCorners()의 관례를 그대로 따른다 — X는 부호를
        // 반전해서 평균(대칭축 기준 공유 반지름), Y/Z는 그대로 평균.
        const avgX = (sim.positions[ix] - sim.positions[jx]) / 2;
        const avgY = (sim.positions[ix + 1] + sim.positions[jx + 1]) / 2;
        const avgZ = (sim.positions[ix + 2] + sim.positions[jx + 2]) / 2;
        if (!iPinned) {
          sim.positions[ix] += (avgX - sim.positions[ix]) * SYMMETRY_BLEND;
          sim.positions[ix + 1] += (avgY - sim.positions[ix + 1]) * SYMMETRY_BLEND;
          sim.positions[ix + 2] += (avgZ - sim.positions[ix + 2]) * SYMMETRY_BLEND;
        }
        if (!jPinned) {
          sim.positions[jx] += (-avgX - sim.positions[jx]) * SYMMETRY_BLEND;
          sim.positions[jx + 1] += (avgY - sim.positions[jx + 1]) * SYMMETRY_BLEND;
          sim.positions[jx + 2] += (avgZ - sim.positions[jx + 2]) * SYMMETRY_BLEND;
        }
      }
    }
  }
}
