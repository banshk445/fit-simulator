import * as THREE from "three";

// 문서 21번(근본 원인 확정): 앞판/뒤판/소매는 각자 별개 BufferGeometry에
// 각자의 위치 텍스처를 물고 있어서, 이음매를 잇는 폴리곤이 구조적으로 0개다
// — 옷은 오직 물리 제약으로만 붙어 있고, 물리가 6mm까지 좁혀도 그 6mm를
// 메우는 삼각형이 없으면 화면엔 그대로 구멍이다. 여기서 그 틈만 덮는 얇은
// 띠(스트립)를 렌더 전용으로 만든다. 물리는 일절 안 건드린다.
//
// 채택 설계는 "CPU 시임 스트립"(설계 옵션1) — 셰이더를 전혀 안 쓴다.
// injectProxyBinding류 텍스처 프록시를 쓰면 three.js 프로그램 캐시가
// onBeforeCompile.toString() 기준이라 customProgramCacheKey 없이는 소매
// 셰이더(다른 cols/rows 상수가 박힌)를 조용히 재사용하는 사고가 난다
// (Garment.tsx의 핏맵 주석에 같은 사고 전례가 기록돼 있다). 정점이
// 100개도 안 되는 띠에 그 위험을 감수할 이유가 없어, 위치를 매 프레임
// CPU에서 직접 써넣는다 — 몸판/소매 coarse 지오메트리가 이미 매 프레임
// 같은 방식으로 갱신되고 있으므로 새로운 비용 종류도 아니다.

// 위치를 읽어올 원본 배열 종류. Garment.tsx가 워커 메시지로 매 프레임
// 갱신하는 네 개의 Float32Array와 1:1 대응한다.
export type SeamSource = "front" | "back" | "sleeveLeft" | "sleeveRight";

export interface SeamSourceArrays {
  front: Float32Array;
  back: Float32Array;
  sleeveLeft: Float32Array;
  sleeveRight: Float32Array;
}

// 정점 하나 = (어느 배열, 그 안 몇 번째 정점). index는 float 인덱스가 아니라
// 정점 인덱스다(실제 읽을 때 *3).
export interface SeamVertexRef {
  source: SeamSource;
  index: number;
}

// 마주보는 두 정점. 스트립의 가로 한 칸을 이룬다.
export interface SeamPair {
  a: SeamVertexRef;
  b: SeamVertexRef;
}

// 시임 = (순서있는 쌍 목록, closed 플래그). 어깨선은 22쌍 open,
// 암홀 링은 12쌍 closed(다음 단계) — 두 경우 모두 이 한 형태로 표현된다.
export interface SeamStrip {
  name: string;
  pairs: SeamPair[];
  closed: boolean;
}

// ---------------------------------------------------------------------------
// 쌍 테이블 (단일 소스)
// ---------------------------------------------------------------------------

// 어깨선 슬릿: 앞판 row0 ↔ 뒤판 row0, 실제로 렌더되는 몸통 열(xMin..xMax)만.
// pinCorners가 이 구간 row0을 앞/뒤 각각 독립적으로 핀하고,
// clothPhysics.ts의 "양쪽 다 핀이면 제약 스킵" 규칙 때문에 물리가 이 간격을
// 아예 안 좁힌다(문서 15번 Q1/Q2) — 그래서 폴리곤으로 덮는 게 맞는 대상이다.
// 열린 스트립이라 쌍 순서가 단순하다(암홀 링의 wrap 순서와 달리).
export function shoulderSeamStrip(xMin: number, xMax: number, cols: number): SeamStrip {
  const pairs: SeamPair[] = [];
  for (let x = xMin; x <= xMax; x++) {
    pairs.push({
      a: { source: "front", index: 0 * cols + x }, // row0
      b: { source: "back", index: 0 * cols + x },
    });
  }
  return { name: "shoulder", pairs, closed: false };
}

// 암홀 링: 몸판 암홀 가장자리 ↔ 소매 row0. 실측 개구폭 2.7cm로 어깨선(0.8cm)
// 보다 훨씬 큰 주범이다(문서 21번).
//
// **순회 순서는 물리 봉제선 addSleeveArmholeSeam(buildGarmentSim.ts)과 반드시
// 같아야 한다** — 아래는 그 함수와 나란히 읽히도록 일부러 같은 구조로 썼다:
//   k = 0..armholeStartRow          → front (col, y=0..armholeStartRow)
//   k = armholeStartRow+1..2·asr+1  → back  (col, y=armholeStartRow..0, 역순)
//   반대쪽(b)은 언제나 소매 (k, row0)
// 순서가 어긋나면 쿼드가 꼬여 화면에 "나비넥타이"로 즉시 드러난다.
// 좌/우 대응도 호출부와 같다: 왼팔 소매 ↔ 열 xMin, 오른팔 소매 ↔ 열 xMax.
//
// 링이므로 closed: true — 마지막 쌍(k=2·asr+1, back row0)과 첫 쌍(k=0,
// front row0)을 잇는 wrap 쿼드가 어깨 코너를 덮는다. 그 코너의 몸판 쪽 두
// 점은 shoulderSeamStrip의 첫(또는 마지막) 쌍과 같은 점이라, 두 스트립이
// 변 하나를 공유하며 어깨 모서리에서 자연스럽게 이어진다(겹침이 아니다).
//
// ponytail: 소매 정점 인덱스가 그냥 k인 건 row0이라 r*SLEEVE_RING_COLS가 0이기
// 때문. 전제는 2*(armholeStartRow+1) === SLEEVE_RING_COLS(현재 12=12)이고,
// 어긋나면 k가 소매 row1로 넘어가 조용히 엉뚱한 정점을 읽는다 —
// scripts/checkSeamBridge.ts가 이 불변식을 실제 상수로 검사한다.
export function armholeSeamStrip(
  name: string,
  torsoCol: number,
  sleeveSource: Extract<SeamSource, "sleeveLeft" | "sleeveRight">,
  armholeStartRow: number,
  cols: number,
): SeamStrip {
  const pairs: SeamPair[] = [];
  let k = 0;
  for (let y = 0; y <= armholeStartRow; y++) {
    pairs.push({ a: { source: "front", index: y * cols + torsoCol }, b: { source: sleeveSource, index: k } });
    k++;
  }
  for (let y = armholeStartRow; y >= 0; y--) {
    pairs.push({ a: { source: "back", index: y * cols + torsoCol }, b: { source: sleeveSource, index: k } });
    k++;
  }
  return { name, pairs, closed: true };
}

// ---------------------------------------------------------------------------
// 지오메트리 (위상만 — 위치는 매 프레임 updateSeamBridge가 채운다)
// ---------------------------------------------------------------------------

// 스트립 하나가 버퍼에서 차지하는 구간. updateSeamBridge가 이 오프셋을 보고
// 자기 몫만 쓴다.
interface StripLayout {
  strip: SeamStrip;
  vertexOffset: number;
}

export interface SeamBridge {
  geometry: THREE.BufferGeometry;
  layouts: StripLayout[];
}

// 정점 배치는 쌍 순서대로 [a0,b0, a1,b1, ...] — 쌍 i가 2i(=a)와 2i+1(=b).
// 쌍 i와 쌍 j(=i+1, closed면 wrap) 사이가 사각형 하나:
//   (a_i, b_i, b_j) + (a_i, b_j, a_j)
// 감기 방향은 전 삼각형이 일관되기만 하면 된다 — 머티리얼이 DoubleSide라
// 앞뒷면 구분이 필요 없고, 법선은 아래 computeVertexNormals가 이 감기에서
// 일관되게 뽑아준다.
export function buildSeamBridge(strips: readonly SeamStrip[]): SeamBridge {
  const layouts: StripLayout[] = [];
  let vertexCount = 0;
  const indices: number[] = [];

  for (const strip of strips) {
    const p = strip.pairs.length;
    const base = vertexCount;
    layouts.push({ strip, vertexOffset: base });
    const quads = strip.closed ? p : p - 1;
    for (let i = 0; i < quads; i++) {
      const j = (i + 1) % p;
      const ai = base + 2 * i;
      const bi = base + 2 * i + 1;
      const aj = base + 2 * j;
      const bj = base + 2 * j + 1;
      indices.push(ai, bi, bj, ai, bj, aj);
    }
    vertexCount += 2 * p;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(vertexCount * 3), 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(vertexCount * 3), 3));
  geometry.setIndex(indices);
  return { geometry, layouts };
}

// ---------------------------------------------------------------------------
// 매 프레임 갱신
// ---------------------------------------------------------------------------

// 법선은 인접 패널에서 빌려오지 않고 스트립 자신의 기하에서 뽑는다.
// 어깨는 앞판 법선이 +Z, 뒤판이 −Z로 ~180° 어긋나 있어서(문서 19번 baseline의
// shoulder 106.9~110.8°) 빌려오면 폭 0.8cm 안에서 법선이 뒤집혀 한쪽이
// 새까맣게 보이거나 조명 각도에 따라 뒤집힌다. 두 법선의 평균도 거의
// 영벡터라 못 쓴다. 스트립의 사각형 외적(=computeVertexNormals)은 어깨를
// 넘어가는 실제 방향(대략 +Y)을 그대로 준다.
//
// ponytail: 지금은 납작한 띠 하나다. 실제 봉제선처럼 살짝 둥글게 만들려면
// 쌍 사이에 중간 행을 하나 넣고 바깥으로 조금 부풀리면 된다(정점 1.5배) —
// 0.8cm 폭에서 그게 눈에 띄는지 화면으로 확인한 뒤에 결정할 것.
export function updateSeamBridge(bridge: SeamBridge, arrays: SeamSourceArrays): void {
  const position = bridge.geometry.getAttribute("position") as THREE.BufferAttribute;
  const dst = position.array as Float32Array;

  for (const { strip, vertexOffset } of bridge.layouts) {
    for (let i = 0; i < strip.pairs.length; i++) {
      const { a, b } = strip.pairs[i];
      writeVertex(dst, vertexOffset + 2 * i, arrays[a.source], a.index);
      writeVertex(dst, vertexOffset + 2 * i + 1, arrays[b.source], b.index);
    }
  }

  position.needsUpdate = true;
  bridge.geometry.computeVertexNormals();
}

function writeVertex(dst: Float32Array, dstVertex: number, src: Float32Array, srcVertex: number): void {
  const d = dstVertex * 3;
  const s = srcVertex * 3;
  dst[d] = src[s];
  dst[d + 1] = src[s + 1];
  dst[d + 2] = src[s + 2];
}
