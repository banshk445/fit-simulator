/* v3-59 §1 — **프린트 UV «정규화 층»**. `garmentScene` 은 `uv` 를 **패턴 미터**로 내고,
 * 프린트 계약은 **[0,1] 정규화 UV** 를 요구한다. 그 사이를 메우는 **유일한 결손**이 이 모듈이다
 * (v3-58 §2-1 판독).
 *
 * 규약은 **v2 계약의 «문언» 준거**다 — `src/lib/patternGarment.ts:306-321` 을 **읽고 옮겼을 뿐**
 * **코드 임포트 0**(G1):
 *     scale = max(모든 패널의 max(폭, 높이))        ← **공통** ⟹ 패널 간 «축척 보존»
 *     u = (x − b.xMin) / scale
 *     v = **1 − (어깨측 끝에서 잰 거리) / scale**    ← 텍스처 «위»(v=1) = 어깨
 *
 * **v3-65 §2 정정 — 구 문언 무삭제**:
 *     구:  `v = 1 − (y − b.yMin) / scale`   「패턴 y 가 아래로 증가 ⟹ 뒤집는다」
 *   그 괄호가 **v2 의 사실**이지 v3 의 사실이 아니었다. **v3-65 §1 실측**:
 *     `garmentScene:388-389` 이 어깨 `topB` 를 **y = L**, 밑단 `botB` 를 **y = 0** 에 둔다
 *     ⟹ **v3 패턴 y 는 «위»로 증가한다**. 독립 채널(정착 세계 y)로 확인 —
 *        front 패턴 y 최대 70.00cm ↔ 세계 y **149.30cm**(어깨) · 패턴 y 최소 0cm ↔ 세계 y **85.69cm**(밑단).
 *   ⟹ 구 식은 **어깨를 v=0** 으로 보냈다(밑단 v=1). flipY=true 가 캔버스 «위»를 v=1 로 올리므로
 *      **화면에서 프린트가 상하 반전**된다(u 에는 뒤집기가 없어 **좌우는 보존** — 증상과 일치).
 *   신:  `v = 1 − (b.yMax − y) / scale`  — **어깨측 끝(y 최대)이 v = 1**.
 *   v2 계약의 «문언»은 그대로다(어깨 끝 → v=1 · 공통 scale · 축척 보존). **y 축 방향만** v3 것으로 읽었다.
 *   범위·축척(G7 ①·②)은 **불변**이다 — 같은 구간을 «방향만» 뒤집는다.
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
    return { xMin, yMin, yMax, w: xMax - xMin, h: yMax - yMin };
  });
  /** **공통** scale — 패널 간 축척을 보존한다(v2 계약 문언 그대로). */
  const scaleM = Math.max(...box.map((b) => Math.max(b.w, b.h)));
  const uv = new Float32Array(uvM.length);
  spans.forEach((s, p) => {
    const b = box[p];
    for (let k = 0; k < s.count; k++) {
      const i = (s.base + k) * 2;
      uv[i] = (uvM[i] - b.xMin) / scaleM;
      /* v3-65 §2 — **어깨측 끝(패턴 y 최대)이 v = 1**. 위 머리주석의 정정 유도 참고. */
      uv[i + 1] = 1 - (b.yMax - uvM[i + 1]) / scaleM;
    }
  });
  return {
    uv, scaleM,
    panels: spans.map((s, p) => ({ name: s.name, base: s.base, count: s.count,
      xMinM: box[p].xMin, yMinM: box[p].yMin, wM: box[p].w, hM: box[p].h,
      uMax: box[p].w / scaleM, vMax: box[p].h / scaleM })),
  };
}
