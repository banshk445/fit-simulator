// 문서 21번(시임 브리지) 토폴로지 자체 점검. buildSeamBridge의 인덱스 산술은
// 틀려도 조용히 통과하는 종류다 — 쌍 순서가 어긋나면 화면에 "나비넥타이"
// 쿼드가 나오고, closed 분기의 wrap이 어긋나면 링 한 칸이 비거나 겹친다.
// 특히 closed 분기(암홀 링용)는 1단계에선 아직 아무도 안 쓰므로 잠복하기 쉽다.
//
// ponytail: 프레임워크 없는 assert 기반 단발 스크립트(check:sleeve와 같은 방식).
// 물리도 three 렌더도 안 돌린다 — 순수하게 정점 개수/삼각형 개수/인덱스 범위/
// 좌표 복사만 본다.
import assert from "node:assert/strict";
import { buildSeamBridge, shoulderSeamStrip, updateSeamBridge, type SeamSourceArrays, type SeamStrip } from "../src/components/seamBridge";

const COLS = 44;

function zeros(n: number): Float32Array {
  return new Float32Array(n * 3);
}

// 실제 어깨선을 닮은 합성 데이터: x=정점 인덱스(어느 인덱스에서 왔는지 식별),
// z=패널별 고정 부호(어느 배열에서 왔는지 식별), y=상수.
// z는 float32에서 정확히 표현되는 값(±0.5)을 쓴다 — 0.4는 Float32Array에
// 넣고 다시 읽으면 0.4000000059604645가 돼 strictEqual에 걸린다.
// 주의: x,y,z를 전부 인덱스에 비례하게 채우면 모든 정점이 한 직선 위에 놓여
// 쿼드 면적이 0이 되고 법선이 전부 0으로 나온다(처음 이렇게 짰다가 아래
// 법선 검사에 걸렸다) — 실제 데이터는 축퇴하지 않으므로 픽스처도 면적을
// 갖게 만들어야 한다.
function fillRibbon(arr: Float32Array, zOffset: number): Float32Array {
  for (let i = 0; i < arr.length / 3; i++) {
    arr[i * 3] = i;
    arr[i * 3 + 1] = 100;
    arr[i * 3 + 2] = zOffset;
  }
  return arr;
}

function triangleCount(bridge: ReturnType<typeof buildSeamBridge>): number {
  const index = bridge.geometry.getIndex();
  assert.ok(index, "인덱스 버퍼가 없다");
  assert.equal(index.count % 3, 0, "인덱스 개수가 3의 배수가 아니다");
  return index.count / 3;
}

function assertIndicesInRange(bridge: ReturnType<typeof buildSeamBridge>): void {
  const index = bridge.geometry.getIndex()!;
  const vertexCount = bridge.geometry.getAttribute("position").count;
  for (let i = 0; i < index.count; i++) {
    const v = index.getX(i);
    assert.ok(v >= 0 && v < vertexCount, `인덱스 ${v}가 정점 범위(0..${vertexCount - 1}) 밖`);
  }
}

// 1) 열린 스트립(어깨선): P쌍 → 2P정점, (P-1)쿼드 = 2(P-1)삼각형.
{
  const xMin = 10;
  const xMax = 33; // 실제 품55 기준값과 같은 24열
  const strip = shoulderSeamStrip(xMin, xMax, COLS);
  const P = xMax - xMin + 1;
  assert.equal(strip.pairs.length, P, "어깨 쌍 개수");
  assert.equal(strip.closed, false, "어깨는 열린 스트립이어야 한다");
  // row0이므로 정점 인덱스는 열 번호 그대로여야 한다.
  assert.equal(strip.pairs[0].a.index, xMin, "첫 쌍 앞판 인덱스 = xMin(row0)");
  assert.equal(strip.pairs[0].a.source, "front");
  assert.equal(strip.pairs[0].b.source, "back");

  const bridge = buildSeamBridge([strip]);
  assert.equal(bridge.geometry.getAttribute("position").count, 2 * P, "열린 스트립 정점 수");
  assert.equal(triangleCount(bridge), 2 * (P - 1), "열린 스트립 삼각형 수(wrap 없음)");
  assertIndicesInRange(bridge);
}

// 2) 닫힌 스트립(암홀 링, 아직 미사용 — 잠복 방지): P쌍 → 2P정점, P쿼드 = 2P삼각형.
{
  const P = 12;
  const ring: SeamStrip = {
    name: "test-ring",
    closed: true,
    pairs: Array.from({ length: P }, (_, k) => ({
      a: { source: "front" as const, index: k },
      b: { source: "sleeveLeft" as const, index: k },
    })),
  };
  const bridge = buildSeamBridge([ring]);
  assert.equal(bridge.geometry.getAttribute("position").count, 2 * P, "닫힌 스트립 정점 수");
  assert.equal(triangleCount(bridge), 2 * P, "닫힌 스트립 삼각형 수(wrap 1쿼드 포함)");
  assertIndicesInRange(bridge);

  // wrap 쿼드가 실제로 마지막 쌍과 첫 쌍을 잇는지 — 마지막 6개 인덱스에
  // 첫 쌍(0,1)과 마지막 쌍(2P-2, 2P-1)이 모두 등장해야 한다.
  const index = bridge.geometry.getIndex()!;
  const lastQuad = new Set<number>();
  for (let i = index.count - 6; i < index.count; i++) lastQuad.add(index.getX(i));
  for (const v of [0, 1, 2 * P - 2, 2 * P - 1]) {
    assert.ok(lastQuad.has(v), `wrap 쿼드에 정점 ${v}가 없다 — 링이 안 닫힘`);
  }
}

// 3) 여러 스트립을 한 버퍼에 담을 때 오프셋이 겹치지 않는지.
{
  const a = shoulderSeamStrip(0, 3, COLS); // 4쌍
  const b = shoulderSeamStrip(10, 12, COLS); // 3쌍
  const bridge = buildSeamBridge([a, b]);
  assert.equal(bridge.geometry.getAttribute("position").count, 2 * (4 + 3), "합산 정점 수");
  assert.equal(bridge.layouts[0].vertexOffset, 0, "첫 스트립 오프셋");
  assert.equal(bridge.layouts[1].vertexOffset, 8, "두 번째 스트립 오프셋 = 첫 스트립 정점 수");
  assert.equal(triangleCount(bridge), 2 * 3 + 2 * 2, "두 열린 스트립 삼각형 합");
  assertIndicesInRange(bridge);
}

// 4) updateSeamBridge가 올바른 원본에서 올바른 자리로 좌표를 복사하는지.
{
  const xMin = 5;
  const xMax = 8;
  const strip = shoulderSeamStrip(xMin, xMax, COLS);
  const bridge = buildSeamBridge([strip]);
  const arrays: SeamSourceArrays = {
    front: fillRibbon(zeros(COLS * 28), 0.5),
    back: fillRibbon(zeros(COLS * 28), -0.5),
    sleeveLeft: zeros(144),
    sleeveRight: zeros(144),
  };
  updateSeamBridge(bridge, arrays);
  const pos = bridge.geometry.getAttribute("position");

  for (let i = 0; i < strip.pairs.length; i++) {
    const col = xMin + i;
    // x는 원본 정점 인덱스(=row0이므로 열 번호), z는 어느 배열에서 왔는지.
    assert.equal(pos.getX(2 * i), col, `쌍 ${i} a쪽이 row0 col${col}이 아닌 곳에서 왔다`);
    assert.equal(pos.getZ(2 * i), 0.5, `쌍 ${i} a쪽이 front가 아닌 배열에서 왔다`);
    assert.equal(pos.getX(2 * i + 1), col, `쌍 ${i} b쪽이 row0 col${col}이 아닌 곳에서 왔다`);
    assert.equal(pos.getZ(2 * i + 1), -0.5, `쌍 ${i} b쪽이 back이 아닌 배열에서 왔다`);
  }

  // 법선이 실제로 채워졌는지(전부 0이면 computeVertexNormals가 안 돌았거나
  // 스트립이 축퇴한 것 — 어깨 법선을 패널에서 빌리지 않는다는 설계의 핵심).
  const normal = bridge.geometry.getAttribute("normal");
  let normalSum = 0;
  for (let i = 0; i < normal.count; i++) normalSum += Math.abs(normal.getX(i)) + Math.abs(normal.getY(i)) + Math.abs(normal.getZ(i));
  assert.ok(normalSum > 0, "법선이 전부 0 — computeVertexNormals가 안 돌았거나 스트립이 축퇴함");
}

console.log("[checkSeamBridge] PASS — 열린/닫힌 스트립 토폴로지, 오프셋, 좌표 복사, 법선 생성 확인");
