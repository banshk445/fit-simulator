import { ClothSimulation } from "./clothPhysics";
import type { ArrayBvhCollision } from "./bvhFromArrays";

// 46번(전면 재설계 — 통합 단일 패널): 소매가 더 이상 별도 패널이 아니라
// 몸판(앞/뒤) 자체의 넓은 바깥쪽 열이므로, 예전에 여기 있던
// addArmholeSeamConstraints(몸판 경계와 소매 링을 잇던 재봉 제약)는 통째로
// 필요 없어졌다 — 같은 격자라 이음매 자체가 존재하지 않는다.

// 어깨 뼈대(관절)에서 수평으로만 밀어내던 것과 별개로, 실제로는 수직으로도
// 살짝 낮다 — 실측(핀 좌표 반경 8cm 안의 최고 Y를 직접 스캔)해보니 핀 Y가
// 실제 어깨 표면 꼭대기보다 항상 약 1.8cm 낮았다. 사용자가 "옷이 어깨가
// 아니라 가슴에 있다"고 지적한 원인 중 하나였다 — shoulderPin.ts의
// SHOULDER_PIN_LIFT로 고쳤다.
//
// 아래 pullShoulderCapToSurface는 그와는 별개로, 어깨~겨드랑이 구간
// 전체를 매 프레임 실제 마네킹 표면 쪽으로 능동적으로 재보정한다 — 자체
// 충돌을 꺼둔 상태에서 이 구간은 중력만으로도 안쪽으로 처지려는 경향이
// 있어(halfWidthAtRow가 초기 배치를 넓혀도 활성 지지가 없으면 도로
// 좁아짐), 옆선 시접(armholeStartRow부터 시작)이 잡아주기 전까지는 이
// 능동 보정이 필요하다. 30번 병합 이후에도 몸판은 여전히 평평한 패널
// 2장이라(진짜 3D 곡면 메쉬가 아님) 이 보정의 필요성 자체는 그대로다.
//
// 32번(가중치를 낮추는 것만으로는 안 통한 이유, 그리고 진짜 수정): 처음엔
// 핀 근처 행일수록 pullWeight를 낮춰(0.15) "약하게만" 당기게 해봤는데
// 실측해보니 거의 변화가 없었다 — 이 함수는 매 프레임(초당 60회) 계속
// 다시 호출되므로, 가중치가 아무리 작아도(0이 아닌 한) 결국 무한히 같은
// 목표점(진짜 마네킹 표면)으로 수렴한다 — 가중치는 "얼마나 빨리
// 수렴하는가"만 바꿀 뿐 "최종적으로 어디에 정착하는가"는 못 바꾼다. 이미
// 여러 초 동안 돌고 있는 시뮬레이션이라 사실상 가중치 크기와 무관하게
// 이미 다 수렴해 있었던 것.
//
// 진짜 고쳐야 했던 건 수렴 "속도"가 아니라 수렴 "목표점" 자체였다 — 목표
// 점 자체를 행 위치에 따라 보간한다: 핀 바로 아래(row 1)에서는 목표점을
// (핀의 실제 좌표)에 가깝게, 겨드랑이(armholeStartRow)에서는 목표점을
// (마네킹 진짜 표면)에 가깝게 잡고 그 사이는 선형 보간한다. 핀 좌표는
// pinCorners가 매 프레임 채워둔 row 0을 그대로 읽어 쓴다(항상 정확).
// 이러면 가중치는 그냥 "얼마나 빨리 그 목표에 도달하는가"로만 쓰이고,
// 목표 자체가 이미 원하는 그라데이션(어깨 캡은 넓게, 겨드랑이는 몸통을
// 따라 좁게)을 담고 있어 weight 크기와 무관하게 올바른 자리에 정착한다.
const SHOULDER_SURFACE_PUSH = 0.13;
const SHOULDER_SURFACE_PULL_WEIGHT = 0.6;

// 46번(전면 재설계): 몸판 열이 이제 소매 끝까지 뻗어 있어, 여기서 쓰던
// "0..cols-1 전체"를 그대로 두면 사용자가 명시적으로 핀을 풀어달라고 한
// 소매 쪽 열까지 마네킹 표면으로 끌어당겨버려("자유롭게 떨어지게" 요청과
// 정반대) 버린다. 몸통 폭 안쪽(xStart~xEnd, buildGarmentSim.ts의
// torsoColumnRange가 계산)만 처리한다.
export function pullShoulderCapToSurface(
  sim: ClothSimulation,
  frontPanel: number,
  backPanel: number,
  armholeStartRow: number,
  xStart: number,
  xEnd: number,
  cols: number,
  dirX: number,
  dirY: number,
  dirZ: number,
  bodySurface: ArrayBvhCollision | null,
): void {
  if (!bodySurface) return;
  for (const panel of [frontPanel, backPanel]) {
    for (let y = 1; y <= armholeStartRow; y++) {
      const rowT = armholeStartRow > 1 ? (y - 1) / (armholeStartRow - 1) : 1;
      for (let x = xStart; x <= xEnd; x++) {
        const i = sim.index(panel, x, y);
        if (sim.pinned[i]) continue;
        const ix = i * 3;
        const px = sim.positions[ix];
        const py = sim.positions[ix + 1];
        const pz = sim.positions[ix + 2];
        const u = x / (cols - 1) - 0.5;
        const outwardSign = u >= 0 ? 1 : -1;
        const qx = px + dirX * outwardSign * SHOULDER_SURFACE_PUSH;
        const qy = py + dirY * outwardSign * SHOULDER_SURFACE_PUSH;
        const qz = pz + dirZ * outwardSign * SHOULDER_SURFACE_PUSH;
        const surface = bodySurface.closestSurfacePoint(qx, qy, qz, SURFACE_MARGIN, SURFACE_DETECTION_RADIUS);
        if (!surface) continue;
        const pinIx = sim.index(panel, x, 0) * 3;
        const pinX = sim.positions[pinIx];
        const pinY = sim.positions[pinIx + 1];
        const pinZ = sim.positions[pinIx + 2];
        const targetX = pinX + (surface.x - pinX) * rowT;
        const targetY = pinY + (surface.y - pinY) * rowT;
        const targetZ = pinZ + (surface.z - pinZ) * rowT;
        sim.positions[ix] = px + (targetX - px) * SHOULDER_SURFACE_PULL_WEIGHT;
        sim.positions[ix + 1] = py + (targetY - py) * SHOULDER_SURFACE_PULL_WEIGHT;
        sim.positions[ix + 2] = pz + (targetZ - pz) * SHOULDER_SURFACE_PULL_WEIGHT;
      }
    }
  }
}

// snapToBodySurface: 마네킹 표면과 옷감 사이 여유(원단 두께 근사) — 몸판
// 충돌(COLLISION_MARGIN=0.015)과 비슷한 수준으로 잡는다.
const SURFACE_MARGIN = 0.012;
const SURFACE_DETECTION_RADIUS = 0.1;

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
