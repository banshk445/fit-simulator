import type { CollisionResolver } from "./clothPhysics";

// 옷감이 접히면서 자기 자신을 뚫고 지나가지 않도록(예: 옆선이 몸에 눌려
// 앞판과 뒤판이 겹치는 경우) 파티클끼리 서로 밀어낸다. 매 반복마다 모든
// 쌍(O(n^2))을 비교하면 파티클 수가 커질 때 감당이 안 되므로, 균일 격자
// 기반 공간 해시로 인접 셀만 비교한다(셀 크기 = minDist이면 3x3x3 이웃
// 셀만 봐도 minDist 이내의 모든 쌍을 놓치지 않는다).
//
// 옷감 두께 자체를 표현하려는 게 아니라 "겹쳐 보이는" 것을 막는 용도라
// minDist는 옷 크기와 무관하게 고정값(실 원단 두께 근사치)을 쓴다.
const SELF_COLLISION_MIN_DIST = 0.01;
// 구조/전단/벤드 제약으로 이미 서로 묶여 있는 인접 파티클끼리는(같은
// 패널에서 UV상 이 반경 이내) 자체충돌 검사에서 제외한다 — 그렇지 않으면
// 정상적으로 붙어 있어야 할 인접 정점을 억지로 떼어놓으려 해서 제약 조건과
// 서로 힘겨루기를 하게 된다.
const SKIP_UV_RADIUS = 2;
// 겹침을 한 번에 완전히 풀려고 하면(계수 1.0) 같은 프레임에 개입하는 다른
// 제약(구조/메시충돌)과 서로 "내가 옳다"며 힘겨루기를 해서 진동·발산할 수
// 있다. 한 번에 일부만 교정하고(under-relaxation) 여러 프레임에 걸쳐
// 서서히 풀리게 해서 이 힘겨루기를 완화한다.
const RELAXATION = 0.3;

interface Bucket {
  indices: number[];
}

export class SelfCollision {
  private readonly particlesPerPanel: number;
  private readonly cols: number;
  private readonly cellSize: number;
  private readonly seamRowExclusive: number;
  private buckets = new Map<number, Bucket>();

  // seamRowExclusive: 어깨선(0번 행)은 앞판/뒤판이 같은 지점에 고정되고
  // (목선 파임이 0인 어깨 끝 쪽은 사실상 완전히 같은 좌표), 옆선 시접
  // 제약이 시작되는 armholeStartRow 행 전까지는 그 두 점을 그대로 이어받아
  // 물리로만 움직이는 "시접 여유" 구간이다 — 명시적 이음매 제약이 없을
  // 뿐, 원래부터 거의 같은 위치에 있어야 정상이다. 이 구간에 자체충돌을
  // 그대로 적용하면, 두 파티클이 이미 SELF_COLLISION_MIN_DIST보다 훨씬
  // 가깝게(때로는 사실상 0 거리로) 시작하는데, 밀어내는 힘의 "크기"는
  // (minDist-dist)/2로 유한하게 잡히지만 "방향"은 두 점이 거의 겹쳐 있을
  // 때 부동소수점 오차 수준의 미세한 차이로 정해져 사실상 무작위에
  // 가깝다 — 그 결과 매 프레임 서로 다른 방향으로 튀어 인접 열끼리
  // 들쭉날쭉한 잔물결(2cm 안팎)이 생기는 문제가 실측(행별 Y좌표 직접
  // 대조)으로 확인됐다. 어깨 핀을 실제 어깨 표면 위치로 보정한 뒤에야
  // 이 구간이 화면에 그대로 드러나면서 눈에 띄게 됐다(그 전에는 핀이
  // 안쪽에 있어 이 구간 자체가 가려져 있었다). 이 구간(seamRowExclusive
  // 미만 행)의 앞판↔뒤판 쌍은 "겹침"이 아니라 "이음매"이므로 자체충돌
  // 대상에서 제외한다.
  constructor(particlesPerPanel: number, cols: number, seamRowExclusive = 0, cellSize = SELF_COLLISION_MIN_DIST) {
    this.particlesPerPanel = particlesPerPanel;
    this.cols = cols;
    this.seamRowExclusive = seamRowExclusive;
    this.cellSize = cellSize;
  }

  private cellKey(cx: number, cy: number, cz: number): number {
    // 옷 시뮬레이션 범위(대략 -2m~2m)를 오프셋으로 양수화해 세 정수 좌표를
    // 하나의 정수 키로 패킹한다. 문자열 키보다 Map 조회가 빠르다.
    return (cx + 512) * 1_048_576 + (cy + 512) * 1024 + (cz + 512);
  }

  private panelAndUV(i: number): { panel: number; x: number; y: number } {
    const local = i % this.particlesPerPanel;
    const panel = (i - local) / this.particlesPerPanel;
    return { panel, x: local % this.cols, y: Math.floor(local / this.cols) };
  }

  createResolver(minDist = SELF_COLLISION_MIN_DIST): CollisionResolver {
    return (positions, pinned, n) => {
      this.buckets.clear();
      const inv = 1 / this.cellSize;

      for (let i = 0; i < n; i++) {
        const ix = i * 3;
        const cx = Math.floor(positions[ix] * inv);
        const cy = Math.floor(positions[ix + 1] * inv);
        const cz = Math.floor(positions[ix + 2] * inv);
        const key = this.cellKey(cx, cy, cz);
        let bucket = this.buckets.get(key);
        if (!bucket) {
          bucket = { indices: [] };
          this.buckets.set(key, bucket);
        }
        bucket.indices.push(i);
      }

      const minDistSq = minDist * minDist;

      for (let i = 0; i < n; i++) {
        const ix = i * 3;
        const px = positions[ix];
        const py = positions[ix + 1];
        const pz = positions[ix + 2];
        const cx = Math.floor(px * inv);
        const cy = Math.floor(py * inv);
        const cz = Math.floor(pz * inv);
        const uvA = this.panelAndUV(i);

        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            for (let dz = -1; dz <= 1; dz++) {
              const bucket = this.buckets.get(this.cellKey(cx + dx, cy + dy, cz + dz));
              if (!bucket) continue;
              for (const j of bucket.indices) {
                if (j <= i) continue; // 각 쌍은 한 번만 처리
                const uvB = this.panelAndUV(j);
                if (
                  uvA.panel === uvB.panel &&
                  Math.abs(uvA.x - uvB.x) <= SKIP_UV_RADIUS &&
                  Math.abs(uvA.y - uvB.y) <= SKIP_UV_RADIUS
                ) {
                  continue;
                }
                if (uvA.panel !== uvB.panel && uvA.y < this.seamRowExclusive && uvB.y < this.seamRowExclusive) {
                  continue; // 어깨 시접 여유 구간 — 겹침이 아니라 이음매다.
                }

                const jx = j * 3;
                const dxp = positions[jx] - px;
                const dyp = positions[jx + 1] - py;
                const dzp = positions[jx + 2] - pz;
                const distSq = dxp * dxp + dyp * dyp + dzp * dzp;
                if (distSq >= minDistSq || distSq < 1e-12) continue;

                const dist = Math.sqrt(distSq);
                const push = ((minDist - dist) / dist / 2) * RELAXATION;
                const pushX = dxp * push;
                const pushY = dyp * push;
                const pushZ = dzp * push;

                const pinnedA = pinned[i];
                const pinnedB = pinned[j];
                if (!pinnedA) {
                  positions[ix] -= pushX;
                  positions[ix + 1] -= pushY;
                  positions[ix + 2] -= pushZ;
                }
                if (!pinnedB) {
                  positions[jx] += pushX;
                  positions[jx + 1] += pushY;
                  positions[jx + 2] += pushZ;
                }
              }
            }
          }
        }
      }
    };
  }
}
