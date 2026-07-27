// 문서 21번(시임 브리지) 토폴로지 자체 점검. buildSeamBridge의 인덱스 산술은
// 틀려도 조용히 통과하는 종류다 — 쌍 순서가 어긋나면 화면에 "나비넥타이"
// 쿼드가 나오고, closed 분기의 wrap이 어긋나면 링 한 칸이 비거나 겹친다.
// 특히 closed 분기(암홀 링용)는 1단계에선 아직 아무도 안 쓰므로 잠복하기 쉽다.
//
// ponytail: 프레임워크 없는 assert 기반 단발 스크립트(check:sleeve와 같은 방식).
// 물리도 three 렌더도 안 돌린다 — 순수하게 정점 개수/삼각형 개수/인덱스 범위/
// 좌표 복사만 본다.
import assert from "node:assert/strict";
import { armholeSeamStrip, buildSeamBridge, shoulderSeamStrip, sideSeamStrip, updateSeamBridge, type SeamSourceArrays } from "../src/components/seamBridge";
import { ARMHOLE_ROW_FRACTION, COLS, ROWS, SLEEVE_RING_COLS, SLEEVE_RING_ROWS } from "../src/lib/clothConfig";

// Garment.tsx가 쓰는 것과 같은 식 — 하드코딩하면 상수가 바뀌었을 때 이
// 체크가 먼저 거짓 통과한다.
const ARMHOLE_START_ROW = Math.round(ROWS * ARMHOLE_ROW_FRACTION);

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

// 2) 닫힌 스트립 = 실제 암홀 링. 순회 순서가 물리 봉제선
// (addSleeveArmholeSeam)과 정확히 같은지가 핵심 — 어긋나면 화면에
// "나비넥타이" 쿼드로 나온다.
{
  // 전제: 링 쌍 개수 = 소매 열 개수. 어긋나면 armholeSeamStrip의 소매
  // 인덱스 k가 row0을 넘어 row1로 넘어가 조용히 엉뚱한 정점을 읽는다.
  assert.equal(
    2 * (ARMHOLE_START_ROW + 1),
    SLEEVE_RING_COLS,
    `링 쌍 개수 2*(armholeStartRow+1)=${2 * (ARMHOLE_START_ROW + 1)}가 SLEEVE_RING_COLS=${SLEEVE_RING_COLS}와 다르다 — armholeSeamStrip의 소매 인덱스가 row1로 넘어간다`,
  );

  const torsoCol = 10;
  const ring = armholeSeamStrip("armholeLeft", torsoCol, "sleeveLeft", ARMHOLE_START_ROW, COLS);
  const P = ring.pairs.length;
  assert.equal(P, SLEEVE_RING_COLS, "암홀 링 쌍 개수 = 소매 열 개수");
  assert.equal(ring.closed, true, "암홀 링은 닫힌 스트립이어야 한다");

  // 순서 검증 — addSleeveArmholeSeam과 같은 규약:
  //   k=0..asr           : front, y=k
  //   k=asr+1..2*asr+1   : back,  y=2*asr+1-k (역순)
  //   b쪽은 언제나 소매 (k, row0) → 정점 인덱스 k
  for (let k = 0; k < P; k++) {
    const { a, b } = ring.pairs[k];
    assert.equal(b.source, "sleeveLeft", `k=${k} b쪽 소스`);
    assert.equal(b.index, k, `k=${k} 소매 정점 인덱스는 k여야 한다(row0)`);
    if (k <= ARMHOLE_START_ROW) {
      assert.equal(a.source, "front", `k=${k}는 front 구간`);
      assert.equal(a.index, k * COLS + torsoCol, `k=${k} front row${k}`);
    } else {
      const y = 2 * ARMHOLE_START_ROW + 1 - k;
      assert.equal(a.source, "back", `k=${k}는 back 구간`);
      assert.equal(a.index, y * COLS + torsoCol, `k=${k} back row${y}(역순)`);
    }
  }
  // 경계 두 지점을 명시적으로 한 번 더 — 겨드랑이(front asr ↔ back asr)와
  // 어깨 코너(wrap: back row0 ↔ front row0).
  assert.equal(ring.pairs[ARMHOLE_START_ROW].a.index, ARMHOLE_START_ROW * COLS + torsoCol, "겨드랑이 직전 = front row(asr)");
  assert.equal(ring.pairs[ARMHOLE_START_ROW + 1].a.index, ARMHOLE_START_ROW * COLS + torsoCol, "겨드랑이 직후 = back row(asr) — 같은 행에서 앞→뒤로 넘어감");
  assert.equal(ring.pairs[P - 1].a.index, 0 * COLS + torsoCol, "마지막 쌍 = back row0(어깨), wrap으로 front row0과 이어짐");

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
    front: fillRibbon(zeros(COLS * ROWS), 0.5),
    back: fillRibbon(zeros(COLS * ROWS), -0.5),
    sleeveLeft: zeros(SLEEVE_RING_COLS * SLEEVE_RING_ROWS),
    sleeveRight: zeros(SLEEVE_RING_COLS * SLEEVE_RING_ROWS),
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

// 5) 스트립 접합부 연속성 — 어깨 스트립 양 끝 쌍과 좌/우 암홀 링의 첫/마지막
// 쌍이 **같은 몸판 정점**을 참조해야 두 띠가 변 하나를 공유하며 이어진다.
// 참조가 어긋나면 어깨 모서리에 삼각형 크기의 구멍이 남는다.
{
  const xMin = 10;
  const xMax = 33;
  const shoulder = shoulderSeamStrip(xMin, xMax, COLS);
  const ringLeft = armholeSeamStrip("armholeLeft", xMin, "sleeveLeft", ARMHOLE_START_ROW, COLS);
  const ringRight = armholeSeamStrip("armholeRight", xMax, "sleeveRight", ARMHOLE_START_ROW, COLS);

  const sameRef = (p: { source: string; index: number }, q: { source: string; index: number }) => p.source === q.source && p.index === q.index;

  // 왼팔 링은 어깨 스트립의 첫 쌍(xMin)과 만난다.
  // 링 k=0은 front row0, 링 마지막(k=11)은 back row0 — 어깨 쌍의 a/b와 각각 같아야 한다.
  assert.ok(sameRef(ringLeft.pairs[0].a, shoulder.pairs[0].a), "왼팔 링 k=0(front row0)이 어깨 스트립 첫 쌍 a와 다른 정점");
  assert.ok(sameRef(ringLeft.pairs[ringLeft.pairs.length - 1].a, shoulder.pairs[0].b), "왼팔 링 마지막(back row0)이 어깨 스트립 첫 쌍 b와 다른 정점");

  // 오른팔 링은 어깨 스트립의 마지막 쌍(xMax)과 만난다.
  const shLast = shoulder.pairs[shoulder.pairs.length - 1];
  assert.ok(sameRef(ringRight.pairs[0].a, shLast.a), "오른팔 링 k=0(front row0)이 어깨 스트립 마지막 쌍 a와 다른 정점");
  assert.ok(sameRef(ringRight.pairs[ringRight.pairs.length - 1].a, shLast.b), "오른팔 링 마지막(back row0)이 어깨 스트립 마지막 쌍 b와 다른 정점");
}

// 6) 옆선 스트립 + 겨드랑이 접합 + 몸판 경계열 커버리지 완결성.
{
  const torsoCol = 10;
  const side = sideSeamStrip("sideLeft", torsoCol, ARMHOLE_START_ROW, ROWS, COLS);
  const ring = armholeSeamStrip("armholeLeft", torsoCol, "sleeveLeft", ARMHOLE_START_ROW, COLS);

  // 쌍 목록: (front(col,y), back(col,y)) for y=asr..ROWS-1
  assert.equal(side.pairs.length, ROWS - ARMHOLE_START_ROW, "옆선 쌍 개수 = ROWS - armholeStartRow");
  assert.equal(side.closed, false, "옆선은 열린 스트립이어야 한다");
  for (let i = 0; i < side.pairs.length; i++) {
    const y = ARMHOLE_START_ROW + i;
    const { a, b } = side.pairs[i];
    assert.equal(a.source, "front", `옆선 i=${i} a쪽은 front`);
    assert.equal(b.source, "back", `옆선 i=${i} b쪽은 back`);
    assert.equal(a.index, y * COLS + torsoCol, `옆선 i=${i} front row${y}`);
    assert.equal(b.index, y * COLS + torsoCol, `옆선 i=${i} back row${y}`);
  }

  // 겨드랑이 접합: 암홀 링의 k=asr → k=asr+1 쿼드가 갖는 몸판 쪽 변이
  // (front row asr ↔ back row asr)이고, 옆선 첫 쌍이 같은 두 정점이어야 한다.
  const sameRef = (p: { source: string; index: number }, q: { source: string; index: number }) => p.source === q.source && p.index === q.index;
  assert.ok(sameRef(side.pairs[0].a, ring.pairs[ARMHOLE_START_ROW].a), "옆선 첫 쌍 a가 암홀 링 k=asr(front row asr)과 다른 정점 — 겨드랑이에 구멍");
  assert.ok(sameRef(side.pairs[0].b, ring.pairs[ARMHOLE_START_ROW + 1].a), "옆선 첫 쌍 b가 암홀 링 k=asr+1(back row asr)과 다른 정점 — 겨드랑이에 구멍");

  // 커버리지 완결성: 몸판 경계열(col=torsoCol)의 앞/뒤 모든 행 0..ROWS-1이
  // 암홀 링 또는 옆선 중 적어도 한 곳에는 등장해야 한다. row 0~4가 어디에도
  // 안 덮이는 상황을 여기서 잡는다(그 구간은 암홀 링이 소매로 덮는다 —
  // 앞↔뒤 슬릿이 아니라 암홀 구멍 자체라 옆선이 담당하지 않는 게 맞다).
  const covered = new Set<string>();
  for (const strip of [ring, side]) {
    for (const pr of strip.pairs) {
      for (const ref of [pr.a, pr.b]) {
        if (ref.source === "front" || ref.source === "back") covered.add(`${ref.source}:${(ref.index - torsoCol) / COLS}`);
      }
    }
  }
  for (const source of ["front", "back"]) {
    for (let y = 0; y < ROWS; y++) {
      assert.ok(covered.has(`${source}:${y}`), `${source} row${y}(col ${torsoCol})이 어느 스트립에도 안 덮임`);
    }
  }

  // 겹침 확인: 링은 몸판 행 0..asr, 옆선은 asr..ROWS-1 — 교집합은 asr 한 행뿐
  // (면이 아니라 변 하나를 공유하는 것이므로 정상).
  const ringRows = new Set<number>();
  for (const pr of ring.pairs) ringRows.add((pr.a.index - torsoCol) / COLS);
  const sideRows = new Set<number>();
  for (const pr of side.pairs) sideRows.add((pr.a.index - torsoCol) / COLS);
  const overlap = [...ringRows].filter((y) => sideRows.has(y));
  assert.deepEqual(overlap, [ARMHOLE_START_ROW], `링과 옆선이 공유하는 행은 armholeStartRow 하나여야 하는데 ${JSON.stringify(overlap)}`);
}

console.log("[checkSeamBridge] PASS — 열린/닫힌 스트립 토폴로지, 암홀 링 순회 순서(물리 봉제선과 동일), wrap 닫힘, 오프셋, 좌표 복사, 법선 생성, 어깨↔암홀 접합부 정점 일치, 옆선 쌍/겨드랑이 접합/경계열 커버리지 완결성 확인");
