// v2 Stage 2b — 패턴 옷을 `ClothSimulation`에 올린다. v2-design §3.3.
//
// **clothPhysics.ts는 한 줄도 고치지 않는다**(2b 정지 조건). 그 제약이
// 아래 두 가지 우회를 강제했고, 둘 다 그 자리에 근거를 남긴다.
//
// ## 1. 제약 종류 — 전부 CONSTRAINT_SEAM, 강성은 **제약별**로 준다
// `addConstraint`는 kind를 SEAM으로 고정한다(격자 위상 밖의 제약을 위한
// API이므로 당연하다). 우리 메시는 격자가 아니라 `buildConstraints`를
// 부를 수 없으니 structural/bend를 kind로 구분할 방법이 없다.
// 대신 `scaleConstraintStiffness`(제약별 배율 API)로 준다:
//   - structural(메시 엣지) = STIFFNESS_STRUCTURAL(1.0) → 배율 1
//   - bend(인접 삼각형의 마주보는 정점 쌍) = STIFFNESS_BEND(0.1)
//     → **반복 보정된 값**을 직접 넣는다: k' = 1 − (1−0.1)^(1/n)
//     A-①의 보정은 `kindTargetStiffness`에만 걸리고 제약별 배율에는 안
//     걸린다. 배율에 0.1을 그냥 넣으면 n=18 반복 누적으로 유효 강성이
//     0.85가 되어 bend 1.0에 가까워진다 — A-②(bend 1.0→0.1, 12콤보
//     면각 +18~63°)가 되돌려진다. n은 원단 프리셋의 iterations다.
//   - seam(시접) = STIFFNESS_SEAM(1.0) → 배율 1
// **shear는 소멸**한다(§3.3, 격자 전용). A-③(shear 완화 → 어깨 미끄러짐
// 참사)의 보호 기능이 비정형 등방 엣지로 흡수된다는 것은 **가정**이고,
// 2b 게이트의 등판 버킷이 그 감시 채널이다.
//
// ## 2. rest length는 **패턴 2D 거리**다 (3D 배치 거리가 아니다)
// 천의 rest 형상은 평평한 패턴이다. 배치는 소매를 원통으로 감으므로 3D
// 거리를 rest로 굳히면 그 곡률이 패턴에 박힌다(스파이크가 "2D를 평면에
// 눕히고 buildConstraints로 굳힌 뒤 배치"한 이유와 같다 — 여기서는 pos2를
// 직접 쓰므로 그 2단계가 필요 없다).
//
// ## 알려진 이탈 1건 — 질량
// §3.3은 "질량 = 정점 Voronoi 면적 비례"를 요구하고 균일 질량을 기각했다
// (graded 메시에서 촘촘한 경계 대역이 면적당 무거워져 낙하 거동이 대역마다
// 왜곡된다). `ClothSimulation`에는 질량 개념이 아예 없다(균일). 도입은
// clothPhysics 수정이므로 **하지 않는다** — 이탈로 등재하고, 2b에서 경계
// 대역(목선·암홀)의 낙하가 내부와 다르게 보이면 1순위 용의자로 본다.
import { ClothSimulation } from "./clothPhysics";
import type { PatternGarment } from "./patternGarment";
import { STIFFNESS_BEND, STIFFNESS_SEAM, STIFFNESS_STRUCTURAL } from "./clothConfig";

export interface PatternSim {
  sim: ClothSimulation;
  weldedShoulderPairs: number;
  structuralPairs: number;
  bendPairs: number;
  seamPairs: number;
  // 실제로 넣은 bend 배율(진단·보고용).
  bendStiffnessPerIteration: number;
  iterations: number;
}

// 인접 삼각형이 공유하는 엣지의 **마주보는 정점 쌍**(§3.3 bend).
function bendPairsOf(tris: Uint32Array): { a: number; b: number }[] {
  const opposite = new Map<number, number[]>();
  for (let t = 0; t < tris.length; t += 3) {
    const v = [tris[t], tris[t + 1], tris[t + 2]];
    for (let i = 0; i < 3; i++) {
      const a = v[i], b = v[(i + 1) % 3], c = v[(i + 2) % 3];
      const k = Math.min(a, b) * 1_000_000 + Math.max(a, b);
      const list = opposite.get(k);
      if (list) list.push(c); else opposite.set(k, [c]);
    }
  }
  const out: { a: number; b: number }[] = [];
  const seen = new Set<number>();
  for (const list of opposite.values()) {
    if (list.length !== 2) continue; // 경계 엣지
    const a = Math.min(list[0], list[1]), b = Math.max(list[0], list[1]);
    const k = a * 1_000_000 + b;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ a, b });
  }
  return out;
}

// `weldShoulder`: 어깨 시접 46쌍을 **구성 시점에 결합**한다(§4 개정 · 제조
// 순서 복원). 선택 근거: 중앙 미러축과 같은 "연속 메시"를 우선 검토했고,
// clothPhysics의 `applyWelds`(alias/canon)가 M1 암홀 용접에서 화면 검증된
// 기존 기계이며 **수정 0줄**이라 그것을 채택했다 — 인덱스 병합(진짜 정점
// 병합)은 패널 오프셋·UV·미러 장부를 전부 다시 짜야 해서 기각.
export function buildPatternSim(g: PatternGarment, iterations: number, weldShoulder = true): PatternSim {
  // 패널당 (cols = 정점 수, rows = 1) — `panelParticleStart`가 g.panelStarts와
  // 정확히 같아진다. `buildConstraints()`는 **부르지 않는다**(격자 제약이
  // 생겨 버린다). 생성자는 제약을 비운 상태로 시작한다.
  const sim = new ClothSimulation(g.panelCounts.map((c) => ({ cols: c, rows: 1 })));
  const total = g.panelCounts.reduce((a, b) => a + b, 0);
  for (let i = 0; i < total; i++) {
    sim.setParticle(i, g.positions[i * 3], g.positions[i * 3 + 1], g.positions[i * 3 + 2]);
  }
  for (let p = 0; p < g.panelStarts.length; p++) {
    if (sim.panelParticleStart(p) !== g.panelStarts[p]) {
      throw new Error(`패널 오프셋 불일치 p${p}: sim ${sim.panelParticleStart(p)} vs garment ${g.panelStarts[p]}`);
    }
  }

  const dist2 = (a: number, b: number): number =>
    Math.hypot(g.pos2[b * 2] - g.pos2[a * 2], g.pos2[b * 2 + 1] - g.pos2[a * 2 + 1]);

  // structural — 메시 엣지 전체, rest = 패턴 2D 거리.
  for (const e of g.edgePairs) sim.addConstraint(e.a, e.b, dist2(e.a, e.b));

  // bend — 패널별 삼각형에서 도출(전역 인덱스는 이미 g.tris에 들어 있다).
  const bend: { a: number; b: number }[] = [];
  for (const r of g.panelTriRanges) {
    bend.push(...bendPairsOf(g.tris.subarray(r.start * 3, (r.start + r.count) * 3)));
  }
  for (const e of bend) sim.addConstraint(e.a, e.b, dist2(e.a, e.b));

  // seam — rest는 **현재 3D 갭**으로 등록하고 S1이 target까지 램프한다(§4).
  for (const s of g.seams) {
    sim.addConstraint(s.a, s.b, Math.hypot(
      g.positions[s.b * 3] - g.positions[s.a * 3],
      g.positions[s.b * 3 + 1] - g.positions[s.a * 3 + 1],
      g.positions[s.b * 3 + 2] - g.positions[s.a * 3 + 2],
    ));
  }

  // 제약별 강성 — 위 주석 1번.
  const bendK = 1 - Math.pow(1 - STIFFNESS_BEND, 1 / Math.max(1, iterations));
  const bendKeys = new Set(bend.map((e) => Math.min(e.a, e.b) * 1_000_000 + Math.max(e.a, e.b)));
  const edgeKeys = new Set(g.edgePairs.map((e) => Math.min(e.a, e.b) * 1_000_000 + Math.max(e.a, e.b)));
  sim.scaleConstraintStiffness((a, b) => {
    const k = Math.min(a, b) * 1_000_000 + Math.max(a, b);
    if (edgeKeys.has(k)) return STIFFNESS_STRUCTURAL;
    if (bendKeys.has(k)) return bendK;
    return STIFFNESS_SEAM;
  });
  // kind는 전부 SEAM이므로 kind 목표는 seam만 의미가 있다(1.0 = 보정 후 1).
  sim.setKindTargetStiffness(STIFFNESS_STRUCTURAL, 1, 1, STIFFNESS_SEAM);

  // 어깨 사전 봉제 — 제약·강성 설정이 **끝난 뒤** 한 번(applyWelds 규약).
  let welded = 0;
  if (weldShoulder) {
    sim.applyWelds(g.shoulderPairs.map((e) => ({ alias: e.b, canon: e.a })));
    welded = g.shoulderPairs.length;
  }

  return {
    sim,
    weldedShoulderPairs: welded,
    structuralPairs: g.edgePairs.length,
    bendPairs: bend.length,
    seamPairs: g.seams.length,
    bendStiffnessPerIteration: bendK,
    iterations,
  };
}
