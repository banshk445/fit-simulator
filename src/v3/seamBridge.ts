/* v3-45 — 시접 «브리지». **표시 전용 기하다. 물리에 한 줄도 관여하지 않는다.**
 *
 * 왜 필요한가(v3-45 §0-2 논증):
 *   `SEP = 2×THICK` 는 시접 rest 이자 자기충돌 «분리 거리»와 «같은 값»이다 ⟹ 이 모델에서
 *   중심면 2mm 의 두 겹은 **표면이 맞닿은** 상태다(v3-13 §3). 그런데 렌더는 두께 0 중심면을
 *   그리므로 **모델이 닫았다고 보는 접촉을 화면이 벌어진 갭으로 그린다.**
 *   브리지는 그 두께를 «그리는» 것이지 없는 물리를 흉내내는 것이 아니다.
 *
 * 하는 일: 시접 쌍 정점열 a[k] ↔ b[k] 사이를 삼각형 스트립으로 잇는 «인덱스»만 만든다.
 * **정점을 새로 만들지 않는다** — 위치 배열은 그대로이므로 어떤 상태도 변형되지 않는다.
 * 소비자는 렌더 호출에서 `idx` 를 이어 붙이기만 한다. `sc.tris` 에는 넣지 않는다.
 */
export type SeamPair = { readonly a: readonly number[]; readonly b: readonly number[] };

/** 시접 스트립 삼각형 인덱스. 와인딩은 한쪽으로 통일한다(진단 래스터는 |n·d| 라 무관,
 *  제품 씬은 양면 재질이라 무관 — 그래도 정점 노멀 누적이 상쇄되지 않게 맞춰 둔다). */
export function seamBridgeIndices(seams: readonly SeamPair[]): Uint32Array {
  const out: number[] = [];
  for (const sm of seams) {
    const n = Math.min(sm.a.length, sm.b.length);
    for (let k = 0; k + 1 < n; k++) {
      const a0 = sm.a[k], a1 = sm.a[k + 1], b0 = sm.b[k], b1 = sm.b[k + 1];
      out.push(a0, b0, b1, a0, b1, a1);
    }
  }
  return Uint32Array.from(out);
}

/** 스트립 개수(= 삼각형 수 / 2) — #89 렌더 기여 목록에 적는 수 */
export const bridgeStripCount = (idx: Uint32Array) => idx.length / 6;

/** 옷 삼각형 뒤에 브리지를 이어 붙인 «표시용» 인덱스. 원본을 건드리지 않는다. */
export function withBridge(clothIdx: Uint32Array, bridgeIdx: Uint32Array): Uint32Array {
  const out = new Uint32Array(clothIdx.length + bridgeIdx.length);
  out.set(clothIdx, 0);
  out.set(bridgeIdx, clothIdx.length);
  return out;
}
