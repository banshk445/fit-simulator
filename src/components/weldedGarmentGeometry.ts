// M1(신 코어) 렌더 — DataTexture 프록시 대신 physIndex 직결 단일 지오메트리.
//
// 렌더 정점 = 파티클 1:1, 전역 파티클 순서 그대로([front, back, sleeveL,
// sleeveR]) — 워커 positions 메시지의 네 배열을 그 순서로 이어 붙이면
// 곧 position attribute라 산란 맵조차 필요 없다. 소매 튜브는 정점 복제
// 없이 인덱스가 col11→col0으로 감아 닫는다. 용접된 시접(암홀 링)은
// 물리에서 alias=canon 동기화되므로 좌표가 비트 단위로 일치 — 이음매
// 폴리곤이 실제로 존재하고(소매 row0 = 몸판 가장자리) 구멍이 구조적으로
// 없다.
//
// 법선: 용접 테이블(canonOf)로 면 법선을 canon 인덱스에 누적 후 정규화 —
// 암홀 경계 법선 불연속이 소멸한다. 어깨/옆선은 의도된 간격(용접 아님)
// 이라 기존처럼 각자 계산 + 브리지가 덮는다.
//
// UV: 파티클 (x,y) → (x/(COLS-1), y/(ROWS-1)) — 구 경로에서 셰이더
// gridUv와 머티리얼 map이 공유하던 유효 매핑과 동일 공식이라 텍스처가
// 같은 자리에 찍힌다(mirroredTexture 좌우 반전 보정 포함, 머티리얼 재사용).
import * as THREE from "three";
import { COLS, ROWS, SLEEVE_RING_COLS, SLEEVE_RING_ROWS } from "../lib/clothConfig";

const F = COLS * ROWS;
const S = SLEEVE_RING_COLS * SLEEVE_RING_ROWS;
export const WELDED_TOTAL_PARTICLES = F * 2 + S * 2;

export interface WeldedGarmentGeometry {
  geometry: THREE.BufferGeometry;
  // canonOf: 전역 파티클 → 용접 대표(weldInfo로 갱신, null이면 항등).
  update(
    front: Float32Array,
    back: Float32Array,
    sleeveLeft: Float32Array,
    sleeveRight: Float32Array,
    canonOf: Uint32Array | null,
  ): void;
  dispose(): void;
}

export function buildWeldedGarmentGeometry(): WeldedGarmentGeometry {
  const positions = new Float32Array(WELDED_TOTAL_PARTICLES * 3);
  const normals = new Float32Array(WELDED_TOTAL_PARTICLES * 3);
  const uvs = new Float32Array(WELDED_TOTAL_PARTICLES * 2);

  // UV — 앞/뒤판만(소매는 단색 머티리얼이라 미사용, 0으로 둠).
  for (let panel = 0; panel < 2; panel++) {
    const base = panel * F;
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const i = base + y * COLS + x;
        uvs[i * 2] = x / (COLS - 1);
        uvs[i * 2 + 1] = y / (ROWS - 1);
      }
    }
  }

  // 인덱스 — 그룹 순서: 앞판(머티리얼 0) / 뒤판(1) / 소매 좌+우(2).
  const index: number[] = [];
  const pushGrid = (base: number, cols: number, rows: number, wrapCols: boolean) => {
    const colCount = wrapCols ? cols : cols - 1;
    for (let y = 0; y < rows - 1; y++) {
      for (let x = 0; x < colCount; x++) {
        const x2 = (x + 1) % cols;
        const a = base + y * cols + x;
        const b = base + y * cols + x2;
        const c = base + (y + 1) * cols + x;
        const d = base + (y + 1) * cols + x2;
        index.push(a, b, c, b, d, c);
      }
    }
  };
  const frontStart = index.length;
  pushGrid(0, COLS, ROWS, false);
  const backStart = index.length;
  pushGrid(F, COLS, ROWS, false);
  const sleeveStart = index.length;
  pushGrid(F * 2, SLEEVE_RING_COLS, SLEEVE_RING_ROWS, true);
  pushGrid(F * 2 + S, SLEEVE_RING_COLS, SLEEVE_RING_ROWS, true);
  const indexEnd = index.length;

  const geometry = new THREE.BufferGeometry();
  const positionAttr = new THREE.BufferAttribute(positions, 3);
  positionAttr.setUsage(THREE.DynamicDrawUsage); // 매 프레임 통째로 갱신(WebKit 함정 — Garment.tsx 주석)
  const normalAttr = new THREE.BufferAttribute(normals, 3);
  normalAttr.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("position", positionAttr);
  geometry.setAttribute("normal", normalAttr);
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(index);
  geometry.addGroup(frontStart, backStart - frontStart, 0);
  geometry.addGroup(backStart, sleeveStart - backStart, 1);
  geometry.addGroup(sleeveStart, indexEnd - sleeveStart, 2);

  const indexArr = Uint32Array.from(index);
  const canonAcc = new Float32Array(WELDED_TOTAL_PARTICLES * 3);

  return {
    geometry,
    update(front, back, sleeveLeft, sleeveRight, canonOf) {
      positions.set(front, 0);
      positions.set(back, F * 3);
      positions.set(sleeveLeft, F * 2 * 3);
      positions.set(sleeveRight, (F * 2 + S) * 3);

      canonAcc.fill(0);
      for (let t = 0; t < indexArr.length; t += 3) {
        const a = indexArr[t] * 3;
        const b = indexArr[t + 1] * 3;
        const c = indexArr[t + 2] * 3;
        const e1x = positions[b] - positions[a];
        const e1y = positions[b + 1] - positions[a + 1];
        const e1z = positions[b + 2] - positions[a + 2];
        const e2x = positions[c] - positions[a];
        const e2y = positions[c + 1] - positions[a + 1];
        const e2z = positions[c + 2] - positions[a + 2];
        const nx = e1y * e2z - e1z * e2y;
        const ny = e1z * e2x - e1x * e2z;
        const nz = e1x * e2y - e1y * e2x;
        for (let k = 0; k < 3; k++) {
          const vi = indexArr[t + k];
          const ci = (canonOf ? canonOf[vi] : vi) * 3;
          canonAcc[ci] += nx;
          canonAcc[ci + 1] += ny;
          canonAcc[ci + 2] += nz;
        }
      }
      for (let i = 0; i < WELDED_TOTAL_PARTICLES; i++) {
        const ci = (canonOf ? canonOf[i] : i) * 3;
        const nx = canonAcc[ci];
        const ny = canonAcc[ci + 1];
        const nz = canonAcc[ci + 2];
        const len = Math.hypot(nx, ny, nz) || 1e-9;
        normals[i * 3] = nx / len;
        normals[i * 3 + 1] = ny / len;
        normals[i * 3 + 2] = nz / len;
      }
      positionAttr.needsUpdate = true;
      normalAttr.needsUpdate = true;
      geometry.computeBoundingSphere();
    },
    dispose() {
      geometry.dispose();
    },
  };
}
