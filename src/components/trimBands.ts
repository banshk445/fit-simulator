// 넥밴드(립)·커프 — **렌더 전용** 트림 밴드.
//
// 물리 손잡이가 아니다. M2-6의 칼라 원주 제약(row0 신장 상한 1.02)이
// 이미 물리 쪽에 있지만, 현 채택 상태는 하드 핀이라 row0 양끝이 고정되어
// **발화 0회**다(측정 확인) — 즉 물리에는 아무 영향이 없다. 여기서 하는
// 일은 그 자리에 실제 옷처럼 보이는 밴드 지오메트리를 얹는 것뿐이고,
// 게이트도 "지표 불변 + 화면에서 티셔츠답게 보이는가"다.
//
// 구조는 seamBridge와 같은 계열(CPU 스트립, 셰이더 없음): 링 정점 목록을
// 받아 각 정점에서 링 바깥/안쪽으로 폭만큼 밀어낸 두 줄을 만들고 그 사이를
// 쿼드로 잇는다. 매 프레임 위치만 다시 쓰고 법선은 지오메트리에서 뽑는다.
import * as THREE from "three";

export interface TrimRing {
  name: string;
  /** 링을 이루는 정점 인덱스(순서대로, 닫힌 고리). 배열 출처는 호출자. */
  read(out: Float32Array, i: number): void;
  /**
   * 링 바로 안쪽 행의 대응 정점(목이면 row1, 커프면 lastRow-1).
   * 밀어낼 방향의 **부호**를 정하는 데만 쓴다 — 접선×방사는 링 감김
   * 방향에 따라 부호가 임의라, 이게 없으면 밴드가 옷 안쪽으로 뻗어
   * 본체에 가려진다(실제로 그랬다. metrics-log 2026-07-29 블록).
   */
  readInner(out: Float32Array, i: number): void;
  count: number;
}

export interface TrimBand {
  geometry: THREE.BufferGeometry;
  update(): void;
  dispose(): void;
}

/**
 * 밴드를 어디에 놓을지 두 가지 — 실측으로 갈렸다(2026-07-29 색 표시 검증).
 *
 * - `extrude`: 가장자리에서 링 평면 수직으로 폭만큼 **밖으로** 뻗는다.
 *   커프는 이게 맞다(소매 끝 너머로 나가 초록 밴드가 또렷이 보였다).
 * - `surfaceInset`: 가장자리와 안쪽 행 사이를 이 비율로 보간한 **옷 표면
 *   위 스트립**. 목은 이거여야 한다 — extrude로 하면 밴드가 위로 뻗어
 *   마네킹 목 안으로 들어가 어깨 부분만 삐져나왔다(빨강 표시로 확인).
 */
export type TrimBandShape =
  | { extrude: number }
  /**
   * lift: 스트립을 몸 바깥으로 살짝 띄우는 양(m). 색 차이(×0.8)만으로는
   * 밴드가 "형태"로 안 읽혀서(2026-07-29 화면 판정) 실제 립처럼 표면 위로
   * 솟게 한다. 방향은 링 중심에서 수평 방사 — 목 링에서는 그게 곧 몸
   * 바깥이라 부호 문제가 없다(extrude의 접선×방사와 달리).
   */
  | { surfaceInset: number; lift?: number };

export function buildTrimBand(rings: readonly TrimRing[], shape: TrimBandShape): TrimBand {
  const total = rings.reduce((n, r) => n + r.count, 0);
  const positions = new Float32Array(total * 2 * 3);
  const indices: number[] = [];
  let base = 0;
  for (const ring of rings) {
    for (let i = 0; i < ring.count; i++) {
      const j = (i + 1) % ring.count;
      const a = base + i * 2;
      const b = base + i * 2 + 1;
      const c = base + j * 2;
      const d = base + j * 2 + 1;
      indices.push(a, b, d, a, d, c);
    }
    base += ring.count * 2;
  }
  const geometry = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(positions, 3);
  posAttr.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("position", posAttr);
  geometry.setIndex(indices);

  const p = new Float32Array(3);
  const prev = new Float32Array(3);
  const next = new Float32Array(3);
  const inner = new Float32Array(3);
  const n = new Float32Array(3);

  return {
    geometry,
    update() {
      let off = 0;
      for (const ring of rings) {
        // 링 중심 — 밀어낼 방향(수직 부호 판정 / 수평 방사 lift)의 기준.
        let cx = 0, cy = 0, cz = 0;
        for (let i = 0; i < ring.count; i++) {
          ring.read(p, i);
          cx += p[0];
          cy += p[1];
          cz += p[2];
        }
        cx /= ring.count;
        cy /= ring.count;
        cz /= ring.count;
        if ("surfaceInset" in shape) {
          // 옷 표면 위 스트립 — 방향 계산이 필요 없다. 가장자리 정점과
          // 안쪽 행 정점 사이를 비율만큼 보간한 두 줄.
          const lift = shape.lift ?? 0;
          for (let i = 0; i < ring.count; i++) {
            ring.read(p, i);
            ring.readInner(inner, i);
            const dx = p[0] - cx;
            const dz = p[2] - cz;
            const dl = Math.hypot(dx, dz) || 1e-9;
            const lx = (dx / dl) * lift;
            const lz = (dz / dl) * lift;
            const o = (off + i * 2) * 3;
            for (let k = 0; k < 3; k++) {
              positions[o + k] = p[k];
              positions[o + 3 + k] = p[k] + (inner[k] - p[k]) * shape.surfaceInset;
            }
            positions[o] += lx;
            positions[o + 2] += lz;
            positions[o + 3] += lx;
            positions[o + 5] += lz;
          }
          off += ring.count * 2;
          continue;
        }
        // 접선(이웃 차) × (중심→정점) = 링 면에 수직. 부호는 링 감김
        // 방향에 달려 임의이므로 아래에서 안쪽 행으로 한 번 결정한다.
        const normalAt = (i: number) => {
          ring.read(p, i);
          ring.read(prev, (i - 1 + ring.count) % ring.count);
          ring.read(next, (i + 1) % ring.count);
          const tx = next[0] - prev[0];
          const ty = next[1] - prev[1];
          const tz = next[2] - prev[2];
          const rx = p[0] - cx;
          const ry = p[1] - cy;
          const rz = p[2] - cz;
          n[0] = ty * rz - tz * ry;
          n[1] = tz * rx - tx * rz;
          n[2] = tx * ry - ty * rx;
          const len = Math.hypot(n[0], n[1], n[2]) || 1e-9;
          n[0] /= len;
          n[1] /= len;
          n[2] /= len;
        };
        // 링 전체에서 "정점→안쪽 행" 방향과의 내적 합. 양수면 밴드가 옷
        // 안쪽을 향하고 있다는 뜻이라 뒤집는다(가장자리 바깥으로 나가야
        // 립/커프처럼 보인다).
        let towardInner = 0;
        for (let i = 0; i < ring.count; i++) {
          normalAt(i);
          ring.readInner(inner, i);
          towardInner +=
            n[0] * (inner[0] - p[0]) + n[1] * (inner[1] - p[1]) + n[2] * (inner[2] - p[2]);
        }
        const sign = towardInner > 0 ? -1 : 1;
        for (let i = 0; i < ring.count; i++) {
          normalAt(i);
          const w = shape.extrude;
          const nx = n[0] * sign;
          const ny = n[1] * sign;
          const nz = n[2] * sign;
          const o = (off + i * 2) * 3;
          positions[o] = p[0];
          positions[o + 1] = p[1];
          positions[o + 2] = p[2];
          positions[o + 3] = p[0] + nx * w;
          positions[o + 4] = p[1] + ny * w;
          positions[o + 5] = p[2] + nz * w;
        }
        off += ring.count * 2;
      }
      posAttr.needsUpdate = true;
      geometry.computeVertexNormals();
      geometry.computeBoundingSphere();
    },
    dispose() {
      geometry.dispose();
    },
  };
}
