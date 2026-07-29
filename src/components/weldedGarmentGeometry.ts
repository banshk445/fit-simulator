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
// 법선: **정점별**로 계산한다(용접 canon으로 평균내지 않는다). 처음엔
// canon 평균이 "암홀 법선 불연속을 없앤다"고 봤는데, 실측하니 정반대였다 —
// 몸판 면(±Z)과 소매 튜브 면(팔축 방사)을 한 정점에서 평균내니 암홀 경계
// 열의 법선이 이웃 열과 최대 130°(뒷면 row0) 어긋나, 그 한 줄이 찢어진
// 것처럼 보였다(정점별로는 4°). 암홀은 실제 봉제선 = 진짜 크리스인데
// 그걸 매끄럽게 이으려 한 게 오류였다. 위치만 용접하고 음영은 가른다.
//
// UV: 파티클 (x,y) → (x/(COLS-1), y/(ROWS-1)) — 구 경로에서 셰이더
// gridUv와 머티리얼 map이 공유하던 유효 매핑과 동일 공식이라 텍스처가
// 같은 자리에 찍힌다(mirroredTexture 좌우 반전 보정 포함, 머티리얼 재사용).
import * as THREE from "three";

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
import { COLS, ROWS, SLEEVE_RING_COLS, SLEEVE_RING_ROWS } from "../lib/clothConfig";

const F = COLS * ROWS;
const S = SLEEVE_RING_COLS * SLEEVE_RING_ROWS;
export const WELDED_TOTAL_PARTICLES = F * 2 + S * 2;

// E: 렌더 전용 세분화(물리 44x28 유지). 파티클 정점은 **앞에 그대로 두고**
// 사이 표본을 뒤에 덧붙인다 — positions.set(front, 0) 같은 1:1 복사 경로와
// setFit의 인덱스 계산이 그대로 유효해야 하기 때문이다.
//
// 경계는 세분화하지 않는다(선형 유지): 목선 행(y=0)과 몸통 경계 열
// (torsoColMin/Max). 각각 넥밴드와 시임 브리지·암홀 용접이 파티클 좌표를
// 그대로 읽어 붙는 자리라, 그 선이 휘면 밴드가 뜨고 이음매가 갈라진다.
// 밑단·내부만 Catmull-Rom으로 부드럽게 한다.
export const RENDER_SUBDIV = 2;
const FX = (COLS - 1) * RENDER_SUBDIV + 1;
const FY = (ROWS - 1) * RENDER_SUBDIV + 1;
const EXTRA_PER_PANEL = FX * FY - COLS * ROWS;
export const WELDED_TOTAL_VERTICES = WELDED_TOTAL_PARTICLES + EXTRA_PER_PANEL * 2;

/**
 * 세분화 격자 (i,j) -> 정점 인덱스. 원래 격자점이면 파티클 인덱스 그대로,
 * 아니면 덧붙인 표본. 산식으로 세다 틀리기 쉬워 한 번 훑어 표로 만든다.
 */
const FINE_MAP: Int32Array[] = [0, 1].map((panel) => {
  const map = new Int32Array(FX * FY);
  let extra = WELDED_TOTAL_PARTICLES + panel * EXTRA_PER_PANEL;
  for (let j = 0; j < FY; j++) {
    for (let i = 0; i < FX; i++) {
      map[j * FX + i] =
        i % RENDER_SUBDIV === 0 && j % RENDER_SUBDIV === 0
          ? panel * F + (j / RENDER_SUBDIV) * COLS + i / RENDER_SUBDIV
          : extra++;
    }
  }
  return map;
});
const fineVertex = (panel: number, i: number, j: number): number => FINE_MAP[panel][j * FX + i];

function catmull(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

// 실측 회귀(M1 화면 확인): 앞/뒤판 삼각형을 전체 44열로 만들었더니 몸통
// 범위(xMin~xMax) 밖 "구 플랩" 열 — 물리로는 계속 돌지만 구 경로에선
// 렌더 제외였던 — 이 화면에 되살아나 암홀 옆 각진 판처럼 돌출했다.
// 구 경로(buildRegionPlaneGeometry)와 동일하게 몸통 열 범위 셀만 삼각형을
// 만든다(정점 배열은 전체 유지 — 파티클 1:1 복사 경로를 안 바꾸기 위해).
export interface WeldedGarmentGeometry {
  geometry: THREE.BufferGeometry;
  update(front: Float32Array, back: Float32Array, sleeveLeft: Float32Array, sleeveRight: Float32Array): void;
  /** 핏 맵용 정점색 갱신(여유 cm). showFitMap일 때만 호출하면 된다. */
  setFit(frontFit: ArrayLike<number>, backFit: ArrayLike<number>): void;
  dispose(): void;
}

export function buildWeldedGarmentGeometry(torsoColMin = 0, torsoColMax = COLS - 1): WeldedGarmentGeometry {
  const positions = new Float32Array(WELDED_TOTAL_VERTICES * 3);
  const normals = new Float32Array(WELDED_TOTAL_VERTICES * 3);
  const uvs = new Float32Array(WELDED_TOTAL_VERTICES * 2);

  // UV — 앞/뒤판만(소매는 단색 머티리얼이라 미사용, 0으로 둠).
  // 세분화 표본도 같은 공식(파티클 격자 좌표계)으로 찍어야 텍스처가 안 밀린다.
  for (let panel = 0; panel < 2; panel++) {
    for (let j = 0; j < FY; j++) {
      for (let i = 0; i < FX; i++) {
        const v = fineVertex(panel, i, j);
        uvs[v * 2] = i / (FX - 1);
        uvs[v * 2 + 1] = j / (FY - 1);
      }
    }
  }

  // 인덱스 — 그룹 순서: 앞판(머티리얼 0) / 뒤판(1) / 소매 좌+우(2).
  const index: number[] = [];
  const pushGrid = (base: number, cols: number, rows: number, wrapCols: boolean, x0 = 0, x1 = cols - 1) => {
    for (let y = 0; y < rows - 1; y++) {
      for (let x = x0; x < (wrapCols ? x1 + 1 : x1); x++) {
        const x2 = (x + 1) % cols;
        const a = base + y * cols + x;
        const b = base + y * cols + x2;
        const c = base + (y + 1) * cols + x;
        const d = base + (y + 1) * cols + x2;
        index.push(a, b, c, b, d, c);
      }
    }
  };
  const pushFineTorso = (panel: number) => {
    const i0 = torsoColMin * RENDER_SUBDIV;
    const i1 = torsoColMax * RENDER_SUBDIV;
    for (let j = 0; j < FY - 1; j++) {
      for (let i = i0; i < i1; i++) {
        const a = fineVertex(panel, i, j);
        const b = fineVertex(panel, i + 1, j);
        const c = fineVertex(panel, i, j + 1);
        const d = fineVertex(panel, i + 1, j + 1);
        index.push(a, b, c, b, d, c);
      }
    }
  };
  const frontStart = index.length;
  pushFineTorso(0);
  const backStart = index.length;
  pushFineTorso(1);
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
  // 핏 맵(신 코어) — 정점색으로 여유(cm)를 칠한다. 구 코어는 셰이더
  // 주입(injectFitMapBinding)으로 하지만 여기는 위치 텍스처 바인딩이
  // 없는 직결 경로라 그 방식을 못 쓴다. **속성은 항상 만들어 둔다** —
  // color attribute가 없는 채로 vertexColors를 켜면 전부 검게 나온다
  // (과거 사고, Garment.tsx 주석).
  const colors = new Float32Array(WELDED_TOTAL_VERTICES * 3).fill(1);
  const colorAttr = new THREE.BufferAttribute(colors, 3);
  colorAttr.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("color", colorAttr);
  geometry.setIndex(index);
  geometry.addGroup(frontStart, backStart - frontStart, 0);
  geometry.addGroup(backStart, sleeveStart - backStart, 1);
  geometry.addGroup(sleeveStart, indexEnd - sleeveStart, 2);

  // 세분화 표본 채우기. 열 방향으로 먼저(행마다), 그다음 행 방향으로.
  // 경계 보존 규칙:
  //  - 목선 행(j=0)은 열 방향 **선형** — 넥밴드가 이 선에 붙는다.
  //  - 몸통 경계 열(x=torsoColMin/Max)은 행 방향 **선형** — 시임 브리지와
  //    암홀 용접이 이 선에 붙는다.
  // 나머지(밑단 포함 내부)만 Catmull-Rom.
  const rowSamples = new Float32Array(FX * ROWS * 3);
  const at = (panel: number, x: number, y: number, k: number) =>
    positions[(panel * F + y * COLS + Math.min(COLS - 1, Math.max(0, x))) * 3 + k];
  const fillFineTorso = (panel: number) => {
    for (let y = 0; y < ROWS; y++) {
      const linearRow = y === 0;
      for (let i = 0; i < FX; i++) {
        const x0 = Math.floor(i / RENDER_SUBDIV);
        const t = (i % RENDER_SUBDIV) / RENDER_SUBDIV;
        const o = (y * FX + i) * 3;
        for (let k = 0; k < 3; k++) {
          const p1 = at(panel, x0, y, k);
          if (t === 0) { rowSamples[o + k] = p1; continue; }
          const p2 = at(panel, x0 + 1, y, k);
          rowSamples[o + k] = linearRow
            ? p1 + (p2 - p1) * t
            : catmull(at(panel, x0 - 1, y, k), p1, p2, at(panel, x0 + 2, y, k), t);
        }
      }
    }
    const rowAt = (y: number, i: number, k: number) => rowSamples[(Math.min(ROWS - 1, Math.max(0, y)) * FX + i) * 3 + k];
    for (let j = 0; j < FY; j++) {
      const y0 = Math.floor(j / RENDER_SUBDIV);
      const t = (j % RENDER_SUBDIV) / RENDER_SUBDIV;
      for (let i = 0; i < FX; i++) {
        if (t === 0 && i % RENDER_SUBDIV === 0) continue; // 원래 파티클 — 건드리지 않는다
        const onBoundaryCol = i % RENDER_SUBDIV === 0 &&
          (i / RENDER_SUBDIV === torsoColMin || i / RENDER_SUBDIV === torsoColMax);
        const v = fineVertex(panel, i, j) * 3;
        for (let k = 0; k < 3; k++) {
          const p1 = rowAt(y0, i, k);
          if (t === 0) { positions[v + k] = p1; continue; }
          const p2 = rowAt(y0 + 1, i, k);
          positions[v + k] = onBoundaryCol
            ? p1 + (p2 - p1) * t
            : catmull(rowAt(y0 - 1, i, k), p1, p2, rowAt(y0 + 2, i, k), t);
        }
      }
    }
  };

  const indexArr = Uint32Array.from(index);
  const normalAcc = new Float32Array(WELDED_TOTAL_VERTICES * 3);

  return {
    geometry,
    setFit(frontFit, backFit) {
      // 색 경계·색상은 injectFitMapBinding의 프래그먼트 셰이더와 같은 값을
      // 쓴다(구/신 코어에서 같은 그림이 나와야 한다).
      const write = (fit: ArrayLike<number>, base: number) => {
        for (let i = 0; i < fit.length; i++) {
          const cm = fit[i];
          const tRed = smoothstep(-0.6, 0.0, cm);
          const tYel = smoothstep(0.6, 1.4, cm);
          const tBlue = smoothstep(2.4, 3.6, cm);
          let r = 0.55 + (0.85 - 0.55) * tRed;
          let g = 0.0 + (0.15 - 0.0) * tRed;
          let b2 = 0.85 + (0.15 - 0.85) * tRed;
          r += (0.95 - r) * tYel;
          g += (0.85 - g) * tYel;
          b2 += (0.1 - b2) * tYel;
          r += (0.15 - r) * tBlue;
          g += (0.45 - g) * tBlue;
          b2 += (0.95 - b2) * tBlue;
          const o = (base + i) * 3;
          colors[o] = r;
          colors[o + 1] = g;
          colors[o + 2] = b2;
        }
      };
      write(frontFit, 0);
      write(backFit, F);
      // 소매는 워커가 여유를 안 보낸다 — 중립(적정=노랑)으로 둔다.
      for (let i = F * 2; i < WELDED_TOTAL_VERTICES; i++) {
        colors[i * 3] = 0.95;
        colors[i * 3 + 1] = 0.85;
        colors[i * 3 + 2] = 0.1;
      }
      colorAttr.needsUpdate = true;
    },
    update(front, back, sleeveLeft, sleeveRight) {
      positions.set(front, 0);
      positions.set(back, F * 3);
      positions.set(sleeveLeft, F * 2 * 3);
      positions.set(sleeveRight, (F * 2 + S) * 3);
      fillFineTorso(0);
      fillFineTorso(1);

      normalAcc.fill(0);
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
          const vi = indexArr[t + k] * 3;
          normalAcc[vi] += nx;
          normalAcc[vi + 1] += ny;
          normalAcc[vi + 2] += nz;
        }
      }
      for (let i = 0; i < WELDED_TOTAL_VERTICES; i++) {
        const ci = i * 3;
        const nx = normalAcc[ci];
        const ny = normalAcc[ci + 1];
        const nz = normalAcc[ci + 2];
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
