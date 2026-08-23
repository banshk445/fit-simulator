/* v3-59 §1 — **프린트 UV «정규화 층»**. `garmentScene` 은 `uv` 를 **패턴 미터**로 내고,
 * 프린트 계약은 **[0,1] 정규화 UV** 를 요구한다. 그 사이를 메우는 **유일한 결손**이 이 모듈이다
 * (v3-58 §2-1 판독).
 *
 * 규약은 **v2 계약의 «문언» 준거**다 — `src/lib/patternGarment.ts:306-321` 을 **읽고 옮겼을 뿐**
 * **코드 임포트 0**(G1):
 *     scale = max(모든 패널의 max(폭, 높이))        ← **공통** ⟹ 패널 간 «축척 보존»
 *     u = (x − b.xMin) / scale
 *     v = **1 − (y − b.yMin) / scale**              ← 패턴 y 가 아래로 증가 ⟹ 뒤집는다
 *                                                     (텍스처 «위» = 어깨)
 * **손 상수 0** — `scale` 과 `xMin`/`yMin` 은 전부 **그 상태의 bbox 에서 도출**된다.
 * 순수성: `node:` 0 · 파일 0 · `process` 0 · console 0 · **three 임포트 0**(표시 층이 소비한다).
 * **`garmentScene.ts` 는 주석 포함 diff 0** — 이 모듈이 그 «출력»만 읽는다(회귀 앵커).
 */

/** 한 패널의 정점 범위. `garmentScene` 의 `panels` 에서 그대로 뜬다. */
export type PanelSpan = { name: string; base: number; count: number };

export type PrintUv = {
  /** [0,1] 정규화 UV — `n × 2`. */
  uv: Float32Array;
  /** 공통 축척[m] — 「uv 1.0 이 몇 미터인가」. 화면이 밝힌다. */
  scaleM: number;
  /** 패널별 bbox(패턴 미터)와 정규화 후 폭·높이. */
  panels: { name: string; base: number; count: number;
    xMinM: number; yMinM: number; wM: number; hM: number; uMax: number; vMax: number }[];
};

/**
 * `assemble()` 출력의 `uv`(패턴 미터 · `n × 2`)와 패널 경계를 받아 v2 계약대로 정규화한다.
 * 입력 배열은 **읽기만** 한다(무변조).
 */
export function buildPrintUv(uvM: Float64Array, spans: readonly PanelSpan[]): PrintUv {
  const box = spans.map((s) => {
    let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
    for (let k = 0; k < s.count; k++) {
      const x = uvM[(s.base + k) * 2], y = uvM[(s.base + k) * 2 + 1];
      if (x < xMin) xMin = x; if (x > xMax) xMax = x;
      if (y < yMin) yMin = y; if (y > yMax) yMax = y;
    }
    return { xMin, yMin, w: xMax - xMin, h: yMax - yMin };
  });
  /** **공통** scale — 패널 간 축척을 보존한다(v2 계약 문언 그대로). */
  const scaleM = Math.max(...box.map((b) => Math.max(b.w, b.h)));
  const uv = new Float32Array(uvM.length);
  spans.forEach((s, p) => {
    const b = box[p];
    for (let k = 0; k < s.count; k++) {
      const i = (s.base + k) * 2;
      uv[i] = (uvM[i] - b.xMin) / scaleM;
      uv[i + 1] = 1 - (uvM[i + 1] - b.yMin) / scaleM;
    }
  });
  return {
    uv, scaleM,
    panels: spans.map((s, p) => ({ name: s.name, base: s.base, count: s.count,
      xMinM: box[p].xMin, yMinM: box[p].yMin, wM: box[p].w, hM: box[p].h,
      uMax: box[p].w / scaleM, vMax: box[p].h / scaleM })),
  };
}
