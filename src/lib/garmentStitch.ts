import { ClothSimulation } from "./clothPhysics";
import type { Vec3Like } from "./clothProtocol";
import type { ArrayBvhCollision } from "./bvhFromArrays";
import { ARMHOLE_ROW_FRACTION, COLS, ROWS, SLEEVE_COLS } from "./clothConfig";

// 큰 재설계(3D 곡면 어깨, 27번, 28번에서 한 차례 시도 후 되돌림): 사용자가
// "어깨를 분리하지 말고 하나의 옷으로 해달라"고 직접 지적한 게 정확한
// 진단이었다 — 몸판과 소매는 이 코드베이스에서 애초에 그리드 크기가
// 달라(몸판 COLS x ROWS, 소매 SLEEVE_COLS x rows) 하나의 ClothSimulation
// 으로 합쳐진 적이 없고(18번부터 계속 별개 인스턴스), 그래서 "한 벌의
// 천"이 아니라 두 조각을 매 프레임 근사적으로 갖다 붙이는 것이었다.
//
// 진짜로 하나의 ClothSimulation으로 합치는 안(패널마다 다른 grid 크기를
// 지원하도록 클래스 자체를 확장)도 검토했지만, 이 프로젝트의 물리
// 엔진·워커·렌더링 코드 전반(collision resolver의 앞/뒤판 분리, 자체
// 충돌, 소매 전용 감쇠/반복 횟수, 세그멘테이션된 postMessage 프로토콜
// 등)이 "몸판과 소매는 별개 시뮬레이션"이라는 전제를 깊이 깔고 있어,
// 이 시점에 억지로 합치면 회귀 위험이 이번 수정의 이득보다 커진다고
// 판단했다.
//
// 28번: ClothSimulation.step()의 everyIterationExtra 훅(원래
// preserveColumnOrder용)을 재사용해 몸판 내부 완화 반복마다(원단별
// 8~24회) 이 보정을 실행해보면 프레임당 한 번보다 훨씬 강할 거라
// 예상했는데, 실측(정면 각도, 틈 수치)해보니 몸판 쪽 반복에만 걸었을
// 땐 이 아래(프레임당 한 번, 6회 내부 반복) 방식과 수치가 거의
// 동일했고, 소매 쪽 반복(sleeveSim.step())에도 같이 걸었더니 오히려
// 틈이 8.6cm→11.1cm로 더 벌어졌다 — Verlet 적분은 속도를 "이전 위치와
// 현재 위치의 차이"로 암묵적으로 계산하는데, 위치만 직접 여러 번(수십
// 회) 홱홱 옮기고 prevPositions는 안 건드리니 매번 그 점프가 암묵적인
// "가짜 속도"로 누적돼, 다음 프레임 적분에서 오히려 더 크게 튕겨
// 나가는 불안정을 만든 것으로 보인다 — 프레임당 한 번(아래) 방식은
// 이 문제가 없다(실측: 8.6cm대로 안정적).
const STITCH_ITERATIONS = 6;
const STITCH_SLEEVE_ROWS = 3;

export function stitchTorsoAndSleeve(
  torsoSim: ClothSimulation,
  sleeveSim: ClothSimulation,
  armholeStartRow: number,
  cols: number,
): void {
  const n = sleeveSim.particlesPerPanel;
  const candidateCount = Math.min(STITCH_SLEEVE_ROWS * SLEEVE_COLS, n);

  for (let iter = 0; iter < STITCH_ITERATIONS; iter++) {
    for (let torsoPanel = 0; torsoPanel < 2; torsoPanel++) {
      for (let y = 1; y <= armholeStartRow; y++) {
        for (let x = 0; x < cols; x++) {
          const u = x / (cols - 1) - 0.5;
          const outerness = Math.min(Math.abs(u) * 2, 1);
          if (outerness <= 0) continue;
          // torsoBoundaryPositions와 같은 대응 관계: 몸판 x=0 열은 소매
          // 패널 0(왼쪽), x=COLS-1 열은 패널 1(오른쪽)과 짝지어진다.
          const sleevePanel = u >= 0 ? 0 : 1;
          const ti = torsoSim.index(torsoPanel, x, y);
          const torsoPinned = torsoSim.pinned[ti] === 1;
          const tix = ti * 3;
          const tx = torsoSim.positions[tix];
          const ty = torsoSim.positions[tix + 1];
          const tz = torsoSim.positions[tix + 2];

          let bestDistSq = Infinity;
          let bestIdx = -1;
          const base = sleevePanel * n;
          for (let k = 0; k < candidateCount; k++) {
            const si = base + k;
            const sIx = si * 3;
            const dx = sleeveSim.positions[sIx] - tx;
            const dy = sleeveSim.positions[sIx + 1] - ty;
            const dz = sleeveSim.positions[sIx + 2] - tz;
            const distSq = dx * dx + dy * dy + dz * dz;
            if (distSq < bestDistSq) {
              bestDistSq = distSq;
              bestIdx = si;
            }
          }
          if (bestIdx < 0) continue;
          const sleevePinned = sleeveSim.pinned[bestIdx] === 1;
          if (torsoPinned && sleevePinned) continue;

          const sIx = bestIdx * 3;
          const dx = sleeveSim.positions[sIx] - tx;
          const dy = sleeveSim.positions[sIx + 1] - ty;
          const dz = sleeveSim.positions[sIx + 2] - tz;

          const moveT = torsoPinned ? 0 : sleevePinned ? 1 : 0.5;
          const moveS = sleevePinned ? 0 : torsoPinned ? 1 : 0.5;

          if (!torsoPinned) {
            torsoSim.positions[tix] += dx * moveT * outerness;
            torsoSim.positions[tix + 1] += dy * moveT * outerness;
            torsoSim.positions[tix + 2] += dz * moveT * outerness;
          }
          if (!sleevePinned) {
            sleeveSim.positions[sIx] -= dx * moveS * outerness;
            sleeveSim.positions[sIx + 1] -= dy * moveS * outerness;
            sleeveSim.positions[sIx + 2] -= dz * moveS * outerness;
          }
        }
      }
    }
  }
}

// 큰 재설계: 몸판과 소매를 어깨 한 점(또는 "가장 가까운 점으로 끌어당기는"
// 근사)이 아니라, 몸판이 실제로 계산한 진동둘레(암홀) 가장자리에 소매
// 이음매 링을 매 프레임 직접 붙인다. 두 ClothSimulation(몸판/소매)은
// 그리드 크기가 달라(몸판 COLS x ROWS, 소매 SLEEVE_COLS x rows) 하나로
// 합칠 수 없어서 여전히 별개 인스턴스로 두지만, 같은 워커
// (garmentWorker.ts) 안에서 함께 관리되므로 몸판의 "이번 프레임" 위치를
// 프레임 지연 없이(메인 스레드를 거치지 않고) 바로 읽어 소매 핀 목표로
// 쓸 수 있다 — 이게 이전(가벼운) 재설계와의 핵심 차이다.
//
// 처음엔 "가까운 정점만 스티치, 먼 정점은 완전히 별개로 원형 핀"이라는
// 이분법(하드 컷오프)으로 구현했는데, 그 경계에서 두 목표 위치가 서로
// 안 이어져 눈에 띄는 이음새/틈이 생기는 게 실측(확대 화면)으로
// 확인됐다. 모든 정점을 "원형 위치 → 가장 가까운 진동둘레 점" 방향으로
// 거리 기반 가중치로 부드럽게 블렌딩(가까울수록 강하게, PULL_RADIUS보다
// 멀면 0)하는 방식으로 바꿔 이 이음새를 없앴다 — 소매 재설계 1차
// 버전(computeSeamRing, 메인 스레드에서 계산)과 같은 블렌딩 수식이지만,
// 이제 몸판과 같은 워커 안에서 그 프레임의 실제 최신 위치로 계산되므로
// 한 프레임 지연이 없다.
const armholeStartRow = Math.round(ROWS * ARMHOLE_ROW_FRACTION);
// 링(circularRing)의 반지름은 이음매 부분이라 radiusSeam(약 2cm) 수준으로
// 작다 — PULL_RADIUS를 그보다 훨씬 크게(예전 0.12=12cm) 잡으면, 이음매
// 원 위의 24개 정점 전부가 진동둘레 가장자리에서 100%에 가까운 가중치로
// 끌려가 원형이 통째로 무너지는 버그가 실측(디버그 좌표 덤프)으로
// 드러났다 — 당시엔 경계를 "가장 가까운 점(꼭짓점 하나)"으로만 찾아서,
// 24개 링 정점 중 다수가 성긴 경계 표본(9개 안팎) 중 같은 하나로
// 한꺼번에 쏠려 이음매 링이 지름 3~4mm짜리 점 무더기로 찌그러졌었다.
// 이후 closestPointOnPolyline로 바꿔 선분 위 연속 투영점을 쓰게 되면서
// (뭉침의 근본 원인이 사라짐) 실측(디버그 거리 덤프)해보니 실제 링→
// 경계 거리는 대부분 0.001~0.02m(1~20mm) 범위였다 — PULL_RADIUS를 이
// 범위를 넉넉히 덮는 0.045로 잡아, 사실상 모든 정점이 진동둘레에 확실히
// 밀착하면서도(피부 비침 틈 제거) 폴리라인 투영 덕에 뭉치지 않는다.
//
// 그런데 탑다운(위에서 내려다보는) 각도에서 사용자가 어깨에 여전히 피부가
// 비쳐 보인다고 재지적해 실측(디버그 좌표 덤프 + weight를 강제로 1로
// 고정해 완전 스냅까지 시도)해보니, PULL_RADIUS를 아무리 키워도(심지어
// weight=1 완전 스냅에서도!) 그 틈이 전혀 줄어들지 않았다 — 즉 이 틈은
// blendSeamRing/PULL_RADIUS와 무관하다는 게 확정됐다. 근본 원인은
// 몸판이 진짜 3D 곡면이 아니라 평평한 패널 2장이 어깨 "점 하나"에서
// 맞닿는 구조라는 것 — 평면은 애초에 마네킹의 둥근 어깨를 감쌀 수 없어서,
// 소매를 아무리 완벽하게 그 경계에 붙여도 평면 자체가 없는 영역(경계
// 폴리라인이 도달 못 하는, 어깨 위/뒤로 곡면이 필요한 부분)은 어차피
// 못 채운다.
//
// 몸판을 3D 곡면 메쉬로 재설계하는 대신(별도 프로젝트급 작업), 이미 정확한
// 마네킹 3D 표면 데이터를 갖고 있는 충돌 메시(BVH)를 재사용해 소매 쪽에서
// 그 빈 영역을 메운다 — snapToBodySurface() 참고. 몸판 경계 블렌딩(아래)이
// 먼저 링을 옆선/암홀 경계에 붙이고, 그걸로 안 닿는(경계 폴리라인이 원래
// 없는 어깨 위쪽) 나머지를 실제 마네킹 표면에 직접 스냅시켜 닫는다.
// PULL_RADIUS는 이 틈과 무관하다는 게 확인됐으니, 원래 목적(뭉침 방지
// 범위를 넉넉히 덮기)에 맞는 값으로 되돌린다.
const PULL_RADIUS = 0.045;
// snapToBodySurface: 마네킹 표면과 옷감 사이 여유(원단 두께 근사) — 몸판
// 충돌(COLLISION_MARGIN=0.015)과 비슷한 수준으로 잡는다.
const SURFACE_MARGIN = 0.012;
// 이 반경 안에서 마네킹 표면을 찾는다 — 실측(디버그 덤프)한 최악의 경우
// 링→경계 거리가 약 6~7cm였던 것을 넉넉히 덮는다.
//
// (처음엔 여기도 거리 기반 가중치로 "살짝만" 당겼는데 — 실측해보니 문제의
// 정점들은 이미 경계 블렌딩으로 어느 정도 당겨진 상태라 실제 표면까지
// 남은 거리가 7cm 안팎이었고, PULL_RADIUS 스타일의 완만한 falloff로는
// weight가 10% 안팎에 그쳐 화면상 변화가 전혀 안 보였다. 이 2단계는
// "가까우면 살짝, 멀면 무시"가 아니라 "탐지 반경 안에서 진짜 표면을
// 찾았으면 그냥 그 자리로 보낸다"는 게 맞는 의도였다 — 그래서 falloff 없이
// 찾으면 100% 스냅하도록 단순화했다.)
const SURFACE_DETECTION_RADIUS = 0.1;

// 몸판의 진동둘레 가장자리 위치를 겨드랑이(뒤판)→어깨→겨드랑이(앞판)
// 순서로 나열한다.
function torsoBoundaryPositions(torsoSim: ClothSimulation, x: number): Vec3Like[] {
  const pts: Vec3Like[] = [];
  const push = (panel: number, y: number) => {
    const i = torsoSim.index(panel, x, y) * 3;
    pts.push({ x: torsoSim.positions[i], y: torsoSim.positions[i + 1], z: torsoSim.positions[i + 2] });
  };
  for (let y = armholeStartRow; y >= 1; y--) push(1, y); // 뒤판
  for (let y = 0; y <= armholeStartRow; y++) push(0, y); // 앞판
  return pts;
}

// 점 p에서 몸판 경계 "폴리라인"(점들을 선분으로 이은 곡선) 위 가장 가까운
// 점을 구한다. 경계를 점(꼭짓점) 목록으로만 보고 그중 가장 가까운 점
// 하나를 고르면(이전 방식), 24개 링 정점 중 여럿이 성긴 표본(9개 안팎)
// 중 같은 하나로 동시에 쏠려 뭉치는 문제가 생긴다 — 선분 위 투영점을
// 쓰면 연속적으로 위치가 바뀌어 뭉침 없이 부드럽게 분산된다.
function closestPointOnPolyline(boundary: Vec3Like[], p: Vec3Like): { point: Vec3Like; distSq: number } {
  let best: Vec3Like = boundary[0];
  let bestDistSq = Infinity;
  for (let i = 0; i < boundary.length - 1; i++) {
    const a = boundary[i];
    const b = boundary[i + 1];
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const abz = b.z - a.z;
    const abLenSq = abx * abx + aby * aby + abz * abz || 1e-9;
    let t = ((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / abLenSq;
    t = Math.max(0, Math.min(1, t));
    const cx = a.x + abx * t;
    const cy = a.y + aby * t;
    const cz = a.z + abz * t;
    const dx = p.x - cx;
    const dy = p.y - cy;
    const dz = p.z - cz;
    const distSq = dx * dx + dy * dy + dz * dz;
    if (distSq < bestDistSq) {
      bestDistSq = distSq;
      best = { x: cx, y: cy, z: cz };
    }
  }
  return { point: best, distSq: bestDistSq };
}

// 몸판 경계 블렌딩이 도달 못 하는 점을, 실제 마네킹 표면(팔 제외 없는
// 전신 BVH — meshCollision.ts의 wholeBodyIndex 참고)에 직접 스냅시킨다.
// bodySurface가 아직 준비 안 됐거나(마운트 직후 rebuildCollision 전) 반경
// 안에서 표면을 못 찾으면 입력을 그대로 반환 — 몸판 경계 블렌딩만으로도
// 이미 대부분 정상 동작하므로 안전한 폴백이다.
function snapToBodySurface(p: Vec3Like, bodySurface: ArrayBvhCollision | null): Vec3Like {
  if (!bodySurface) return p;
  const target = bodySurface.closestSurfacePoint(p.x, p.y, p.z, SURFACE_MARGIN, SURFACE_DETECTION_RADIUS);
  if (!target) return p;
  return { x: target.x, y: target.y, z: target.z };
}

// 큰 재설계(3D 곡면 어깨, 21번 이후): halfWidthAtRow의 클램프를 없애 어깨
// 쪽 초기 배치/rest length를 넓혀도, 그 구간을 붙잡아줄 활성 지지가 전혀
// 없어(0번 행만 핀으로 고정, 옆선 시접은 armholeStartRow부터 시작) 중력+
// 구조 제약이 매 프레임 다시 안쪽으로 처지게 만든다는 게 실측(Playwright
// evaluate로 몸판 바깥쪽 열과 소매 이음매 링의 실제 정착 좌표를 직접
// 대조)으로 드러났다 — armholeStartRow를 3→5행으로 늘려봐도 정착 좌표는
// 거의 그대로였다(초기 배치만으로는 부족, 매 프레임 능동적으로 다시
// 당겨줘야 유지된다).
//
// snapToBodySurface처럼 "현재 위치에서 가장 가까운 표면"을 그대로 찾으면
// 안 된다 — 현재 위치가 이미 안쪽으로 처져 있으면 그 근처(가슴/목 표면)
// 만 찾을 뿐 바깥쪽(어깨 캡) 표면을 "발견"하지 못한다(검색 자체에
// 방향성이 없으므로). 그래서 검색 시작점을 어깨선 방향(dirX/Y/Z, 왼쪽
// 어깨→오른쪽 어깨)을 기준으로 각 열이 속한 쪽(u의 부호)으로
// SHOULDER_SURFACE_PUSH만큼 인위적으로 밀어낸 뒤, 그 지점에서 가장 가까운
// 실제 표면을 찾는다 — 옷이 얼마나 처져 있든 항상 "바깥쪽"을 먼저
// 살펴보게 만드는 것. 찾은 진짜 표면 쪽으로 매 프레임 일부만(0.35,
// 하드 핀이 아님 — 인접 행을 완전 고정하면 뒤틀리는 회귀가 이 코드베이스
// 전반에서 반복 확인됐다) 당겨, 중력이 다시 끌어내리기 전에 계속
// 재보정한다.
const SHOULDER_SURFACE_PUSH = 0.13;
const SHOULDER_SURFACE_PULL_WEIGHT = 0.7;

export function pullShoulderCapToSurface(
  torsoSim: ClothSimulation,
  armholeStartRow: number,
  cols: number,
  dirX: number,
  dirY: number,
  dirZ: number,
  bodySurface: ArrayBvhCollision | null,
): void {
  if (!bodySurface) return;
  for (let panel = 0; panel < 2; panel++) {
    for (let y = 1; y <= armholeStartRow; y++) {
      for (let x = 0; x < cols; x++) {
        const i = torsoSim.index(panel, x, y);
        if (torsoSim.pinned[i]) continue;
        const ix = i * 3;
        const px = torsoSim.positions[ix];
        const py = torsoSim.positions[ix + 1];
        const pz = torsoSim.positions[ix + 2];
        const u = x / (cols - 1) - 0.5;
        const outwardSign = u >= 0 ? 1 : -1;
        const qx = px + dirX * outwardSign * SHOULDER_SURFACE_PUSH;
        const qy = py + dirY * outwardSign * SHOULDER_SURFACE_PUSH;
        const qz = pz + dirZ * outwardSign * SHOULDER_SURFACE_PUSH;
        const target = bodySurface.closestSurfacePoint(qx, qy, qz, SURFACE_MARGIN, SURFACE_DETECTION_RADIUS);
        if (!target) continue;
        torsoSim.positions[ix] = px + (target.x - px) * SHOULDER_SURFACE_PULL_WEIGHT;
        torsoSim.positions[ix + 1] = py + (target.y - py) * SHOULDER_SURFACE_PULL_WEIGHT;
        torsoSim.positions[ix + 2] = pz + (target.z - pz) * SHOULDER_SURFACE_PULL_WEIGHT;
      }
    }
  }
}

// 몸판 경계 블렌딩(아래)이 얼마나 확실하게 이 정점을 붙잡았는지의
// 가중치가 이 값보다 낮으면(=경계 폴리라인이 이 정점 근처에 아예 없다는
// 뜻) 몸 표면 스냅 대상으로 본다. 처음엔 "모든 정점마다 항상 몸 표면을
// 먼저 찾고, 찾으면 무조건 그걸로 확정"하는 방식으로 짰는데 — 실측(정면
// 화면)해보니 이음매 링 대부분(경계 블렌딩이 이미 옆선에 잘 붙여둔
// 점들까지) 각자 가장 가까운 팔/어깨 표면 점으로 따로따로 스냅되면서
// 원형 단면이 뭉개져, 소매가 원통이 아니라 어깨에서 옆으로 펄럭이는 깃발/
// 박쥐 날개처럼 납작해지는 심각한 회귀가 나왔다 — 경계 블렌딩이 잘 커버하는
// 대다수 정점은 건드리지 말고, 진짜 안 닿는(탑다운 각도에서 보이던 그
// 틈에 해당하는) 소수 정점만 몸 표면 스냅 대상으로 좁혀야 한다.
const BODY_SURFACE_SNAP_THRESHOLD = 0.5;

// 소매 이음매 링 정점의 "원형 기준 위치"(circularRing, buildSleeveSim.ts의
// seamCircularRing이 계산)를 받아 최종 목표 위치를 돌려준다. 먼저 몸판
// 경계로 거리 기반 블렌딩하고(대다수 정점은 이걸로 충분), 그 가중치가
// BODY_SURFACE_SNAP_THRESHOLD보다 낮은(=경계 폴리라인이 근처에 없는, 탑다운
// 각도에서 피부가 비쳐 보이던 소수 정점만) 경우에 한해 실제 마네킹 표면
// (어깨 곡면 포함, snapToBodySurface)에 직접 스냅시킨다 — 원형 기준 위치
// (경계 블렌딩 전)에서 찾는다, 이미 옆선 쪽으로 당겨진 위치에서 다시
// 찾으면 정작 채워야 할 어깨 위쪽과는 다른 표면을 찾아버리기 때문.
export function blendSeamRing(
  torsoSim: ClothSimulation,
  sleevePanel: number,
  circularRing: Vec3Like[],
  bodySurface: ArrayBvhCollision | null,
): Vec3Like[] {
  const torsoX = sleevePanel === 0 ? 0 : COLS - 1;
  const boundary = torsoBoundaryPositions(torsoSim, torsoX);

  return circularRing.map((circ) => {
    const { point: best, distSq } = closestPointOnPolyline(boundary, circ);
    const dist = Math.sqrt(distSq);
    const weight = Math.max(0, 1 - dist / PULL_RADIUS);

    if (weight < BODY_SURFACE_SNAP_THRESHOLD) {
      const surfaceSnapped = snapToBodySurface(circ, bodySurface);
      if (surfaceSnapped !== circ) return surfaceSnapped;
    }

    return {
      x: circ.x + (best.x - circ.x) * weight,
      y: circ.y + (best.y - circ.y) * weight,
      z: circ.z + (best.z - circ.z) * weight,
    };
  });
}
