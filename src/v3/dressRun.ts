/* v3-35 — 착장 «실행»의 순수 부분. Node 하네스와 브라우저 워커가 «같은 코드»를 돈다.
 *
 * 왜 공유하는가: 워커가 자기 루프를 따로 쓰면 Node ↔ 브라우저 차이가 「엔진 차이」인지
 * 「내 루프가 다른 것」인지 가릴 수 없다(v3-35 §0 ㉠).
 *
 * 담는 것: 몸 SDF 굽기 · 장면 조립 · 점진 봉제 램프 · 프레임 스텝 · «창 순변위» 진행률.
 * 담지 «않는» 것: 파일 I/O · 인쇄 · 체크포인트 · 시험 7종 · 캡처 — 전부 측정·실행 제어다.
 *
 * 램프 식·솔버 파라미터는 `scripts/v3S4.ts` S5 블록의 «그 줄»을 옮긴 것이다(로직 변경 0).
 * 순수성(§0 ㉡): `node:` 임포트 0 · 파일 접근 0 · `process` 0.
 */
import { bakeSdf, deriveSpacing, type GridSdf } from './bodySdf.ts';
import { parseGlb, weldMap } from './glb.ts';
import { createScene, type SceneConfig } from './garmentScene.ts';
import { step, type SolverParams } from './solver.ts';

/** v3S4 상수 — 앞 회차 등재분 그대로. 하네스도 같은 값을 쓴다. */
export const V3CONST = {
  G: 9.81, DT: 1 / 60, THICK: 1e-3, SEP: 2e-3, MU: 0.3, DAMP: 6,
  TOL_SELF: 1e-4, SDF_BUDGET: 64 * 1024 * 1024,
} as const;

export type Fabric = { k: number; rho: number; B: number };
/** v3-26 §1 등재분 — 이름과 값이 한 곳에만 있게 한다(#57 계열 방지) */
export const FABRICS: Record<string, Fabric> = {
  gray: { k: 69, rho: 0.187, B: 2.3191698e-5 },
  denim: { k: 2027.8, rho: 0.324, B: 6.42e-5 },
  sweat: { k: 25, rho: 0.224, B: 5.947e-5 },
  swim: { k: 209.2, rho: 0.204, B: 6.024e-5 },
};

export type RunInput = {
  /** GLB 바이트 — Node는 파일에서, 브라우저는 fetch로 얻는다 */
  glb: ArrayBuffer;
  /** 몸 축 비례 [x,y,z] · 기본 1/1/1 */
  bodyScale?: [number, number, number];
  /** 옷 치수 [m] — 제품 UI 입력 */
  garment?: { L: number; W: number; SW: number; SLEN: number; ARM_G: number };
  fabric: Fabric;
  /** 해상도 [m] — 제품 설정은 d11(v3-33 갈래 B) */
  d?: number;
  /** 프레임 상한 */
  frames?: number;
  /** 서브스텝 강제(진단용). 없으면 «산정» */
  substeps?: number;
  minPairDistLite: SceneConfig['minPairDistLite'];
  /** v3-36 §2 — **진단 전용**. 조립이 만든 f=0 정점을 «주입한 값»으로 갈아끼운다.
   * 층 분리(조립 ↔ 물리)를 가르기 위한 것이고 물리 로직은 한 줄도 안 바뀐다.
   * 형식은 `stateBlob` 과 같다(헤더 + pos + vel). 정점 수가 다르면 «정지»한다. */
  injectState?: ArrayBuffer;
};

export const DEFAULT_GARMENT = { L: 0.7, W: 0.55, SW: 0.449995105850059, SLEN: 0.22, ARM_G: 0.4439 };

export type Progress = { frame: number; frames: number; netMm: number };

/** 장면을 만들고 몸 SDF를 굽는다 — 스텝 «전»까지. */
export function prepare(inp: RunInput) {
  const { G, DT, THICK, SEP, TOL_SELF, SDF_BUDGET } = V3CONST;
  const { prims } = parseGlb(inp.glb);
  const prim0 = prims[0];
  const weld = weldMap(prim0.pos, 0);
  const bodyIdx = Uint32Array.from(prim0.idx, (v) => weld[v]);
  const BS = inp.bodyScale ?? [1, 1, 1];
  if (BS[0] !== 1 || BS[1] !== 1 || BS[2] !== 1)
    for (let v = 0; v < prim0.pos.length; v += 3) {
      prim0.pos[v] *= BS[0]; prim0.pos[v + 1] *= BS[1]; prim0.pos[v + 2] *= BS[2];
    }
  const BEXT: [number, number, number] = [1.78 * BS[0], 1.765 * BS[1], 0.282 * BS[2]];
  const sdfSpec = deriveSpacing(BEXT, SDF_BUDGET, THICK);
  const bodyG: GridSdf = bakeSdf(prim0.pos, bodyIdx, sdfSpec.h, sdfSpec.band);
  const gd = inp.garment ?? DEFAULT_GARMENT;
  const d = inp.d ?? 0.011;
  const S = createScene({
    body: prim0, bodyIdx, bodyG, sdfSpec,
    L: gd.L, W: gd.W, SW: gd.SW, SLEN: gd.SLEN, ARM_G: gd.ARM_G,
    G, DT, THICK, SEP, KMEM: inp.fabric.k, MAT: { rho: inp.fabric.rho, B: inp.fabric.B },
    TOL_SELF, D_FIXED: d, minPairDistLite: inp.minPairDistLite,
  });
  const sc = S.assemble(d);
  const st = S.substepsOf(sc);
  const SUB = inp.substeps ?? st.sub;
  const seg3 = (p: Float64Array, a: number, b: number) =>
    Math.hypot(p[a * 3] - p[b * 3], p[a * 3 + 1] - p[b * 3 + 1], p[a * 3 + 2] - p[b * 3 + 2]);
  const rest0 = sc.seamCons.map((c) => seg3(sc.s.pos, c.i, c.j));
  const RAMP_N = Math.ceil((Math.max(...rest0) - SEP) / (G * DT * DT));
  const setRest = (f: number) => {
    const t = Math.min(1, f / RAMP_N);
    for (let k = 0; k < sc.seamCons.length; k++) sc.seamCons[k].rest = rest0[k] + (SEP - rest0[k]) * t;
  };
  const params: SolverParams = {
    dt: DT, substeps: SUB, gravity: G, damping: V3CONST.DAMP,
    collision: { colliders: [{ kind: 'grid', g: bodyG }], thickness: THICK, mu: V3CONST.MU },
    selfCollision: { tris: sc.tris, thickness: THICK, every: 1 },
  };
  if (inp.injectState) {
    const dv = new DataView(inp.injectState);
    const hl = dv.getUint32(0, true);
    const hdr = JSON.parse(new TextDecoder().decode(new Uint8Array(inp.injectState, 4, hl)));
    if (hdr.n !== sc.n) throw new Error(`주입 상태의 정점 수가 다르다 (${hdr.n} ≠ ${sc.n})`);
    const nb = sc.n * 3 * 8;
    sc.s.pos.set(new Float64Array(inp.injectState.slice(4 + hl, 4 + hl + nb)));
    sc.s.vel.set(new Float64Array(inp.injectState.slice(4 + hl + nb, 4 + hl + 2 * nb)));
  }
  return { S, sc, bodyG, sdfSpec, d, SUB, sub: st, RAMP_N, setRest, params, prim0, bodyIdx };
}

export type Prepared = ReturnType<typeof prepare>;

/** N_WIN 프레임마다 «창 순변위»를 낸다 — v3-22 채널. 진행률 표시에 쓴다. */
export const N_WIN = Math.round(1 / (V3CONST.DAMP * V3CONST.DT));

/**
 * 프레임을 돈다. `onProgress` 는 N_WIN 마다 불린다.
 * `shouldStop` 이 true 를 내면 그 자리에서 멈춘다(취소).
 * 반환은 «마지막 프레임 번호»와 발산 여부뿐 — 판정은 바깥이 한다.
 */
export function runFrames(
  P: Prepared,
  frames: number,
  onProgress?: (p: Progress) => void,
  shouldStop?: () => boolean,
): { frame: number; diverged: boolean; stopped: boolean } {
  const { sc, setRest, params } = P;
  let ref = Float64Array.from(sc.s.pos);
  let f = 0;
  for (; f < frames; f++) {
    setRest(f + 1);
    step(sc.s, sc.cons, params);
    if (!Number.isFinite(sc.s.pos[0])) return { frame: f + 1, diverged: true, stopped: false };
    if ((f + 1) % N_WIN === 0) {
      let net = 0;
      for (let v = 0; v < sc.n; v++)
        net = Math.max(net, Math.hypot(
          sc.s.pos[v * 3] - ref[v * 3], sc.s.pos[v * 3 + 1] - ref[v * 3 + 1], sc.s.pos[v * 3 + 2] - ref[v * 3 + 2]));
      onProgress?.({ frame: f + 1, frames, netMm: net * 1000 });
      if (shouldStop?.()) return { frame: f + 1, diverged: false, stopped: true };
      ref = Float64Array.from(sc.s.pos);
    }
  }
  return { frame: f, diverged: false, stopped: false };
}

/** 하네스 체크포인트와 «같은 형식»의 blob — Node가 바이트로 대조한다(§2). */
export function stateBlob(P: Prepared, frame: number, placeSig: string): Uint8Array {
  const n = P.sc.n;
  const hdr = new TextEncoder().encode(JSON.stringify({ frame, n, d: P.d, place: placeSig }));
  const nb = n * 3 * 8;
  const out = new Uint8Array(4 + hdr.length + nb * 2);
  new DataView(out.buffer).setUint32(0, hdr.length, true);
  out.set(hdr, 4);
  out.set(new Uint8Array(P.sc.s.pos.buffer, P.sc.s.pos.byteOffset, nb), 4 + hdr.length);
  out.set(new Uint8Array(P.sc.s.vel.buffer, P.sc.s.vel.byteOffset, nb), 4 + hdr.length + nb);
  return out;
}
