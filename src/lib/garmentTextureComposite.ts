// 46번(전면 재설계) 이후 몸판 텍스처는 사진 전체를 몸판 UV 0~1에 그대로
// 늘려 붙였다 — 소매까지 사진 배경/여백이 통째로 감기고, 프린트 그래픽도
// 실제 인쇄 비율과 무관하게 몸판 치수에 맞춰 늘어나 보이는 문제가 있었다.
// 대신 몸판 전체를 원단 대표색으로 칠하고, 그 위에 실제 프린트 영역만
// 원본 비율 그대로 가슴 중앙에 합성한다 — 소매는 이 캔버스의 프린트
// 영역 바깥(대표색 그대로)을 그대로 물려받으므로 별도 처리가 필요 없다.

// 프린트 인식 스캔 해상도. 실측 아님, 성능/정밀도 절충으로 고른 눈대중 값.
const SCAN_SIZE = 128;

// 47번(테두리 기반 대표색): 처음엔 averageGarmentColor(garmentColor.ts —
// 이 파일은 그대로 가져다 쓰기만 하고 수정하지 않았다)를 그대로 썼는데,
// 그 함수는 이미지 중앙 60%에서 최빈값을 뽑는다 — 프린트가 가슴
// 중앙(딱 그 60% 영역)에 있는 옷에서는 원단이 아니라 프린트 안의 색이
// "대표색"으로 뽑히는 구조적 문제가 실측으로 확인됐다. 원단은 보통
// 목선/어깨/밑단 등 프레임 가장자리에도 넓게 드러나는 반면 프린트는
// 중앙에 몰려 있다는 전제로, 중앙 대신 프레임 가장자리 띠에서 최빈값을
// 뽑는다.
//
// 47번 실측(버그 — 다운샘플이 얇은 원단 테두리를 그래픽과 섞어버림):
// 처음엔 이 스캔도 SCAN_SIZE(128) 다운샘플에서 했는데, 실사진에서 대표색이
// 여전히 청회색(#6e7e9b)으로 나왔다 — 원본(828x1028) 기준 실제 원단
// 테두리 폭이 28~40px(전체 폭의 약 3~4%)뿐이라, 128칸으로 눌러 그리는
// 과정의 리샘플링(브라우저 기본 보간)이 이 얇은 띠를 바로 안쪽 그래픽
// 색과 섞어버렸다. 원본 해상도 그대로(리샘플 없이) 픽셀을 읽어야 얇은
// 테두리 색이 안 섞인다 — 실측(같은 사진, 원본 해상도로 다시 샘플)으로
// #293654(짙은 남색, 진짜 원단에 가까움)가 나오는 것으로 확인.
//
// 47번 실측(2번째 버그, 진짜 원인 — 색공간 이중 변환): 위 수정 후에도
// 실제 컴포넌트 안에서는 계속 틀린(더 밝은) 색(#707f9b)이 나왔다.
// 처음엔 "디코드/래스터 타이밍 레이스"로 의심해 decode(),
// createImageBitmap, fetch+blob 디코드, 지연(delay)까지 다 시도했지만
// 전부 실패했다 — 원인은 타이밍이 아니라 new THREE.Color(r,g,b)였다.
// three.js는 r152+ 기본으로 ColorManagement를 켜두는데, 실수 3개짜리
// Color 생성자는 그 값을 "linear working space"로 취급한다. 여기선
// getImageData가 주는 이미 sRGB로 인코딩된 픽셀 바이트를 그대로
// 넣었으니, 나중에 getHexString()이 "linear → sRGB" 변환을 한 번 더
// 걸어 감마를 이중으로 먹였다(#293654를 linear로 착각하고 sRGB로
// 인코딩하면 정확히 #707f9b가 나옴 — 수식으로 확인됨). 이 파일은 3D
// 머티리얼 색이 아니라 2D 캔버스 채우기색만 다루므로, THREE.Color를
// 아예 쓰지 않고 sRGB 바이트 값을 그대로 CSS rgb()로 쓰면 이 함정
// 자체가 사라진다.
function borderRepresentativeColor(image: HTMLImageElement): { r: number; g: number; b: number } {
  const w = image.naturalWidth || image.width;
  const h = image.naturalHeight || image.height;
  if (!w || !h) return { r: 128, g: 128, b: 128 };

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return { r: 128, g: 128, b: 128 };
  ctx.drawImage(image, 0, 0); // 리샘플 없이 원본 해상도 그대로.
  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(0, 0, w, h).data;
  } catch {
    return { r: 128, g: 128, b: 128 }; // cross-origin 오염 등의 안전한 폴백.
  }

  // 가장자리에서 안쪽으로 이 비율만큼의 띠만 표본으로 쓴다(그 안쪽은
  // "중앙"으로 보고 제외) — averageGarmentColor의 중앙 60% 샘플링과
  // 정반대 영역. 실측 아님, 눈대중 초기값.
  const BORDER_BAND_FRACTION = 0.08;
  const bandX = Math.round(w * BORDER_BAND_FRACTION);
  const bandY = Math.round(h * BORDER_BAND_FRACTION);
  const BUCKET = 24; // averageGarmentColor와 같은 폭 — 최빈값이 무의미해지지 않을 정도로.

  const buckets = new Map<string, { r: number; g: number; b: number; count: number }>();
  for (let y = 0; y < h; y++) {
    const inBorderRow = y < bandY || y >= h - bandY;
    for (let x = 0; x < w; x++) {
      if (!inBorderRow && x >= bandX && x < w - bandX) continue; // 중앙 — 건너뜀
      const i = (y * w + x) * 4;
      const a = data[i + 3];
      if (a < 10) continue; // 투명(배경 제거된 영역)
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      if (r > 235 && g > 235 && b > 235) continue; // 흰 배경/여백 잔여물
      const key = `${Math.floor(r / BUCKET)},${Math.floor(g / BUCKET)},${Math.floor(b / BUCKET)}`;
      const entry = buckets.get(key);
      if (entry) {
        entry.r += r;
        entry.g += g;
        entry.b += b;
        entry.count += 1;
      } else {
        buckets.set(key, { r, g, b, count: 1 });
      }
    }
  }

  let best: { r: number; g: number; b: number; count: number } | null = null;
  for (const entry of buckets.values()) {
    if (!best || entry.count > best.count) best = entry;
  }
  if (!best) return { r: 128, g: 128, b: 128 }; // 테두리도 전부 배경/흰색뿐 — 드문 경우.
  return { r: best.r / best.count, g: best.g / best.count, b: best.b / best.count };
}

// 대표색과의 RGB 유클리드 거리가 이보다 크면 "프린트(원단과 다른 색)"로
// 본다. 실측 아님, 눈대중 초기값.
const PRINT_COLOR_DIST_THRESHOLD = 55;

// 프린트 박스가 프레임의 가로/세로 중 어느 한쪽이라도 이 비율 이상을
// 차지하면 "무지 옷인데 배경 제거가 불완전해 전체가 프린트로 잡힌 것"
// 으로 보고 프린트 없이 대표색만 쓴다. 실측 아님, 눈대중 초기값.
const PRINT_MAX_FRAME_FRACTION = 0.9;

// 캔버스에 배치하는 프린트의 가로 폭 — 몸판 텍스처 전체 폭 대비 비율.
// 실측 아님, 눈대중 초기값(요청 범위 40~50%의 중간값).
const PRINT_WIDTH_FRACTION = 0.45;
// 프린트 상단이 시작되는 세로 위치 — 캔버스 상단(어깨선)에서부터의 비율.
// 실측 아님, 눈대중 초기값.
const PRINT_TOP_FRACTION = 0.25;

const OUTPUT_SIZE = 512;

interface PrintBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

// 대표색과 충분히 다른 픽셀들의 바운딩 박스를 원본 이미지 픽셀 좌표로
// 구한다 — 없으면(무지 옷) null.
// P34 §1 — 반환을 `{box, parts}`로 넓혔다. `box`는 **종전과 비트 동일**하고,
// `parts`는 **경계에 안 닿는 8-연결 성분들의 개별 bbox**다(78회차 재스캔이 쓰는
// 것과 «같은 집합» — 새 규칙 0). 성분 분리는 이제 항상 돌지만 `box` 산출 경로에는
// 관여하지 않는다(재스캔 발동 조건·`onRescan` 발화 시점도 종전 그대로).
interface PrintScan {
  box: PrintBox | null;
  parts: PrintBox[];
}

function findPrintBoundingBox(
  image: HTMLImageElement,
  srcW: number,
  srcH: number,
  color: { r: number; g: number; b: number },
  onOversize?: (box: PrintBox) => void,
  onRescan?: (d: { components: number; excluded: number; box: PrintBox | null }) => void,
): PrintScan {
  const scanCanvas = document.createElement("canvas");
  scanCanvas.width = SCAN_SIZE;
  scanCanvas.height = SCAN_SIZE;
  const ctx = scanCanvas.getContext("2d");
  if (!ctx) return { box: null, parts: [] };
  ctx.drawImage(image, 0, 0, SCAN_SIZE, SCAN_SIZE);
  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(0, 0, SCAN_SIZE, SCAN_SIZE).data;
  } catch {
    return { box: null, parts: [] }; // cross-origin 오염 등 — 안전하게 "프린트 없음"으로 취급.
  }

  const { r: r0, g: g0, b: b0 } = color;

  // 78회차 — 후보 화소를 **마스크로도 남긴다**(bbox 산출식은 그대로).
  // 문턱에 걸렸을 때만 쓰는 재스캔(G2′)의 입력이고, 미발동 경로에서는 읽히지 않는다.
  const mask = new Uint8Array(SCAN_SIZE * SCAN_SIZE);
  let minX = SCAN_SIZE;
  let minY = SCAN_SIZE;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < SCAN_SIZE; y++) {
    for (let x = 0; x < SCAN_SIZE; x++) {
      const i = (y * SCAN_SIZE + x) * 4;
      if (data[i + 3] < 10) continue; // 투명(배경 제거된 영역)
      const dr = data[i] - r0;
      const dg = data[i + 1] - g0;
      const db = data[i + 2] - b0;
      if (Math.sqrt(dr * dr + dg * dg + db * db) < PRINT_COLOR_DIST_THRESHOLD) continue;
      mask[y * SCAN_SIZE + x] = 1;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  if (maxX < 0) return { box: null, parts: [] };

  const scaleX = srcW / SCAN_SIZE;
  const scaleY = srcH / SCAN_SIZE;
  const box: PrintBox = {
    x: minX * scaleX,
    y: minY * scaleY,
    w: (maxX - minX + 1) * scaleX,
    h: (maxY - minY + 1) * scaleY,
  };
  // 71회차 — 문턱 발동을 **밖에서 구분할 수 있게** 상자를 함께 넘긴다.
  // (이전에는 "프린트 없음"과 "프레임 초과"가 둘 다 null이라 판별자가 못 갈랐다.)
  const oversized = (b: PrintBox): boolean =>
    b.w >= srcW * PRINT_MAX_FRAME_FRACTION || b.h >= srcH * PRINT_MAX_FRAME_FRACTION;

  // ── 78회차 처방 **G2′**의 성분 분리 — P34에서 «항상» 돌린다. ────────────────
  // 알파 없는 흰 배경 자산에서는 배경이 통째로 "프린트"로 잡혀 bbox가 프레임 전체가
  // 된다(76·77회차 실측: 100%×100%). 색으로는 못 가른다 — 배경을 완벽히 지워도
  // **실루엣 1픽셀 후광 링**이 남고 그 밝기가 프린트와 겹친다(후광 min 64 vs 프린트 med 113).
  // 그래서 색이 아니라 **위상**을 쓴다: 후보 화소를 8-연결 성분으로 나누고
  // **프레임 경계에 닿는 성분을 제외**한다(배경은 정의상 경계에 닿는다).
  // **새 상수 0**(문턱도 근백색 술어도 안 쓴다) · **1패스 미발동 자산은 여기 오지 않으므로
  // 경로가 정의상 동일**하다 → v1 거동 불변(게이트 불요).
  // 재스캔 후에도 걸리면 기존대로 프린트를 버린다.
  const label = new Int32Array(SCAN_SIZE * SCAN_SIZE).fill(-1);
  const stack: number[] = [];
  let nComp = 0, nExcluded = 0;
  const parts: PrintBox[] = [];
  let rMinX = SCAN_SIZE, rMinY = SCAN_SIZE, rMaxX = -1, rMaxY = -1;
  for (let start = 0; start < mask.length; start++) {
    if (mask[start] === 0 || label[start] !== -1) continue;
    const id = nComp++;
    let touchesEdge = false;
    let cMinX = SCAN_SIZE, cMinY = SCAN_SIZE, cMaxX = -1, cMaxY = -1;
    label[start] = id;
    stack.length = 0;
    stack.push(start);
    while (stack.length > 0) {
      const cur = stack.pop() as number;
      const cx = cur % SCAN_SIZE, cy = (cur / SCAN_SIZE) | 0;
      if (cx === 0 || cy === 0 || cx === SCAN_SIZE - 1 || cy === SCAN_SIZE - 1) touchesEdge = true;
      if (cx < cMinX) cMinX = cx;
      if (cx > cMaxX) cMaxX = cx;
      if (cy < cMinY) cMinY = cy;
      if (cy > cMaxY) cMaxY = cy;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= SCAN_SIZE || ny >= SCAN_SIZE) continue;
          const ni = ny * SCAN_SIZE + nx;
          if (mask[ni] === 0 || label[ni] !== -1) continue;
          label[ni] = id;
          stack.push(ni);
        }
      }
    }
    if (touchesEdge) { nExcluded++; continue; }
    // P34 — 성분 «개별» bbox. 합집합(rescanBox)은 아래에서 종전대로 따로 낸다.
    parts.push({
      x: cMinX * scaleX, y: cMinY * scaleY,
      w: (cMaxX - cMinX + 1) * scaleX, h: (cMaxY - cMinY + 1) * scaleY,
    });
    if (cMinX < rMinX) rMinX = cMinX;
    if (cMaxX > rMaxX) rMaxX = cMaxX;
    if (cMinY < rMinY) rMinY = cMinY;
    if (cMaxY > rMaxY) rMaxY = cMaxY;
  }

  // 1패스가 문턱을 안 넘으면 종전대로 여기서 끝난다 — `onRescan`은 발화하지 않는다
  // (「재스캔 미실행」이라는 판별자의 뜻을 P34가 바꾸지 않는다).
  if (!oversized(box)) return { box, parts };

  const rescanBox: PrintBox | null = rMaxX < 0 ? null : {
    x: rMinX * scaleX, y: rMinY * scaleY,
    w: (rMaxX - rMinX + 1) * scaleX, h: (rMaxY - rMinY + 1) * scaleY,
  };
  if (onRescan) onRescan({ components: nComp, excluded: nExcluded, box: rescanBox });
  if (rescanBox && !oversized(rescanBox)) return { box: rescanBox, parts };
  if (onOversize) onOversize(box);
  return { box: null, parts };
}

// ── 71회차 v2 적응 (선택 인자 · **미전달이면 v1과 계산 동치**) ────────────────
// v1 몸판은 UV u∈[0,1] 전체를 쓰지만 v2 패널은 자기 bbox만 쓴다(69·70회차 실측:
// 몸판 u∈[0, 55/70 = 0.7857]). 프린트 폭·중심을 그 **`uMax`에서 재도출**한다 —
// **새 상수 0**이고 `uMax=1`이면 아래 두 식이 기존 값과 정확히 같아진다.
// `onDiag`는 71회차 §3 거짓-갈래 판별자다(대표색·프린트 bbox·프레임 비율·
// PRINT_MAX_FRAME_FRACTION 발동 여부). **인쇄만 하고 계산에 관여하지 않는다.**
export interface CompositeOptions {
  uMax?: number;
  // P32 §1 — 원본 프레임 «안»에서 옷이 차지하는 픽셀 박스. 주어지면 프린트의
  // 위치·상대 폭을 이 박스 기준으로 읽어 캔버스의 «같은 상대 자리»에 싣는다.
  // 미전달(또는 null)이면 종전 상수 배치 그대로다 — **v1은 이 인자를 안 넘기므로
  // 계산이 종전과 비트 동일**하다(`Garment.tsx:341`).
  garmentRegion?: { x: number; y: number; w: number; h: number } | null;
  onDiag?: (d: {
    color: { r: number; g: number; b: number };
    printBox: PrintBox | null;
    frameFracW: number;
    frameFracH: number;
    maxFrameFired: boolean;
    corner00: { r: number; g: number; b: number } | null;
    // 78회차 G2′ — 재스캔이 돌았는지, 경계 접촉 성분을 몇 개 뺐는지, 그 결과 bbox.
    // 재스캔이 안 돌면 null이다(1패스 미발동 = 경로 불변의 직접 증거).
    rescan: { components: number; excluded: number; box: PrintBox | null } | null;
    // P34 — 경계에 안 닿는 성분들의 «개별» bbox. 성분별 배치가 실제로 몇 개를
    // 옮겼는지 밖에서 셀 수 있어야 한다(빈 배열이면 상수 폴백으로 떨어진 것).
    parts: PrintBox[];
  }) => void;
}

// 몸판 전체를 대표색(테두리 기반)으로 칠하고, 실제 프린트 영역(있다면)만
// 원본 비율 그대로 가슴 중앙에 합성한 캔버스를 반환한다.
export function compositeGarmentTexture(image: HTMLImageElement, opts?: CompositeOptions): HTMLCanvasElement {
  const uMax = opts?.uMax ?? 1;
  const representativeColor = borderRepresentativeColor(image);
  const canvas = document.createElement("canvas");
  canvas.width = OUTPUT_SIZE;
  canvas.height = OUTPUT_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  const { r, g, b } = representativeColor;
  ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
  ctx.fillRect(0, 0, OUTPUT_SIZE, OUTPUT_SIZE);

  const srcW = image.naturalWidth || image.width;
  const srcH = image.naturalHeight || image.height;
  if (!srcW || !srcH) return canvas;

  let oversize: PrintBox | null = null;
  let rescan: { components: number; excluded: number; box: PrintBox | null } | null = null;
  const scan = findPrintBoundingBox(
    image, srcW, srcH, representativeColor,
    (b) => { oversize = b; },
    (d) => { rescan = d; },
  );
  const printBox = scan.box;
  if (opts?.onDiag) {
    // 판별자 — 문턱 전 상자(`printBox ?? oversize`)로 프레임 비율을 낸다.
    // `maxFrameFired`는 **문턱이 실제로 걸렸을 때만** 참이다(프린트 없음과 구분된다).
    const raw: PrintBox | null = printBox ?? oversize;
    let corner00: { r: number; g: number; b: number } | null = null;
    try {
      const d = ctx.getImageData(0, 0, 1, 1).data;
      corner00 = { r: d[0], g: d[1], b: d[2] };
    } catch { corner00 = null; }
    opts.onDiag({
      color: representativeColor,
      printBox: raw,
      frameFracW: raw ? raw.w / srcW : 0,
      frameFracH: raw ? raw.h / srcH : 0,
      maxFrameFired: oversize !== null,
      corner00,
      rescan,
      parts: scan.parts,
    });
  }
  if (!printBox) return canvas;

  const printAspect = printBox.w / printBox.h;
  // v2 적응: 패널이 쓰는 u 대역 [0, uMax]를 기준으로 폭·중심을 잡는다.
  // uMax=1이면 `OUTPUT_SIZE*PRINT_WIDTH_FRACTION` / `(OUTPUT_SIZE-destW)/2`로 환원된다.
  const panelW = OUTPUT_SIZE * uMax;

  // ── P32 §1 — 원본 위치·크기 승계 ──────────────────────────────────────────
  // 캔버스 세로 [0, OUTPUT_SIZE]가 패널 v[1, 0](어깨선→밑단) 전체이고,
  // 가로 [0, panelW]가 패널 u[0, uMax] 전체다(P31 §1-2 실측). 그래서 옷 박스
  // 안에서의 상대 좌표를 그대로 곱하면 «같은 자리»가 된다. 새 상수 0.
  const gr = opts?.garmentRegion;

  // ── P34 §1 — **성분별 개별 배치**. ────────────────────────────────────────
  // 종전에는 후보 화소 «전량»의 단일 bbox 하나를 옮겼다. 그래서 목 리브/라벨
  // (69px)이 프린트 본체(866px)와 한 상자에 묶여 상단을 끌어올렸다(P33 §1-3).
  // 성분을 각자 «자기» 상대 자리에 옮기면 그 묶임이 원리적으로 사라진다 —
  // **선택 규칙이 없으므로 새 문턱도 반례도 없다**(「최대 성분만」의 반례였던
  // 가슴+소매 2프린트도 둘 다 제자리로 간다).
  // 집합은 재스캔 G2′가 쓰는 것과 «같다» — 경계에 닿는 성분 제외(새 규칙 0).
  // 잡음 성분이 옷 전역에 흩어져 있으면 **원본과 같은 자리**에 그대로 찍힌다.
  // `garmentRegion`이 없으면(v1 · ?autofit=1 · 크롭 실패) 아래 상수 폴백 그대로다.
  if (gr && gr.w > 0 && gr.h > 0 && scan.parts.length > 0) {
    for (const part of scan.parts) {
      const pw = panelW * (part.w / gr.w);
      const ph = pw / (part.w / part.h);
      ctx.drawImage(
        image, part.x, part.y, part.w, part.h,
        panelW * ((part.x - gr.x) / gr.w), OUTPUT_SIZE * ((part.y - gr.y) / gr.h), pw, ph,
      );
    }
    return canvas;
  }


  let destW: number;
  let destH: number;
  let destX: number;
  let destY: number;
  if (gr && gr.w > 0 && gr.h > 0) {
    destW = panelW * (printBox.w / gr.w);
    destH = destW / printAspect;
    destX = panelW * ((printBox.x - gr.x) / gr.w);
    destY = OUTPUT_SIZE * ((printBox.y - gr.y) / gr.h);
  } else {
    // 폴백 — 상대 좌표를 못 얻었다(크롭 분석 실패 · v1 경로 · ?autofit=1).
    // 눈대중 상수 2개는 **이 경로 전용**으로 남는다(P32 §1 · 삭제 0).
    destW = panelW * PRINT_WIDTH_FRACTION;
    destH = destW / printAspect;
    destX = (panelW - destW) / 2;
    destY = OUTPUT_SIZE * PRINT_TOP_FRACTION;
    // 캔버스 하단 초과 금지 — `destH`에 상한이 없어 종횡비 0.5면 밑단 3cm
    // 앞까지 내려간다(P31 §2-3). 종횡비를 지키려 폭도 같은 비율로 줄이고,
    // **잘렸다는 사실을 조용히 넘기지 않는다**(P15 클램프-고지 선례).
    const maxH = OUTPUT_SIZE - destY;
    if (destH > maxH) {
      const shrink = maxH / destH;
      console.warn(
        `[P32 폴백 클램프] 프린트 세로가 캔버스를 넘어 축소했다 — ` +
        `종횡비 ${printAspect.toFixed(3)} · destH ${destH.toFixed(1)}px → ${maxH.toFixed(1)}px ` +
        `(×${shrink.toFixed(3)}) · destW ${destW.toFixed(1)}px → ${(destW * shrink).toFixed(1)}px. ` +
        `상대 좌표(garmentRegion) 없이 상수 배치로 떨어진 경로다.`,
      );
      destH = maxH;
      destW *= shrink;
      destX = (panelW - destW) / 2;
    }
  }
  ctx.drawImage(image, printBox.x, printBox.y, printBox.w, printBox.h, destX, destY, destW, destH);

  return canvas;
}
