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
  count: number;
}

export interface TrimBand {
  geometry: THREE.BufferGeometry;
  update(): void;
  dispose(): void;
}

// widthM: 밴드 폭(링 평면 안쪽으로). 실제 티셔츠 넥립 2cm, 커프 2.5cm 근방.
export function buildTrimBand(rings: readonly TrimRing[], widthM: number): TrimBand {
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

  return {
    geometry,
    update() {
      let off = 0;
      for (const ring of rings) {
        // 링 중심 — 밴드를 안쪽으로 밀 방향의 기준.
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
        for (let i = 0; i < ring.count; i++) {
          ring.read(p, i);
          ring.read(prev, (i - 1 + ring.count) % ring.count);
          ring.read(next, (i + 1) % ring.count);
          // 접선(이웃 차) × (중심→정점)으로 링 면에 수직인 방향을 얻는다.
          const tx = next[0] - prev[0];
          const ty = next[1] - prev[1];
          const tz = next[2] - prev[2];
          const rx = p[0] - cx;
          const ry = p[1] - cy;
          const rz = p[2] - cz;
          let nx = ty * rz - tz * ry;
          let ny = tz * rx - tx * rz;
          let nz = tx * ry - ty * rx;
          const len = Math.hypot(nx, ny, nz) || 1e-9;
          nx /= len;
          ny /= len;
          nz /= len;
          const o = (off + i * 2) * 3;
          positions[o] = p[0];
          positions[o + 1] = p[1];
          positions[o + 2] = p[2];
          positions[o + 3] = p[0] + nx * widthM;
          positions[o + 4] = p[1] + ny * widthM;
          positions[o + 5] = p[2] + nz * widthM;
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
