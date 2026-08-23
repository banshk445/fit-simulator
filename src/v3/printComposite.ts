/* v3-60 §1 — **프린트 «합성 층»**. 자산 «원본»을 앞판 전면에 붙이던 v3-59 의 미완을 닫는다.
 *
 * 규약은 **v2 계약의 «문언» 준거**다 — `src/lib/garmentTextureComposite.ts` 를 **읽고 옮겼을 뿐**
 * **코드 임포트 0**(G1). 옮긴 것과 «옮기지 않은 것»을 여기 명시한다.
 *
 * ── 옮긴 것(문언·값 그대로) ────────────────────────────────────────────────
 *  ① **대표색 = `borderRepresentativeColor`**(`:43-100`) — **테두리 띠의 최빈 색 버킷 평균**.
 *     `BORDER_BAND_FRACTION 0.08` · `BUCKET 24` · 알파 < 10 제외 · rgb > 235 흰 배경 제외.
 *     **`averageGarmentColor` 는 쓰지 않는다** — v1 이 «실패로 등재»한 경로다(v2 주석 :11-15 · 70 §5-1).
 *  ② **프린트 bbox** — 대표색과의 RGB 거리 > `PRINT_COLOR_DIST_THRESHOLD 55` 인 화소의 bbox.
 *     `SCAN_SIZE` 다운샘플 스캔 · 프레임의 `PRINT_MAX_FRAME_FRACTION 0.9` 이상이면 **프린트 버림**.
 *  ③ **배치(폴백 경로)** — `destW = panelW × PRINT_WIDTH_FRACTION 0.45` ·
 *     `destX = (panelW − destW)/2` · `destY = OUTPUT_SIZE × PRINT_TOP_FRACTION 0.25` ·
 *     `panelW = OUTPUT_SIZE × uMax`. **하단 초과 시 종횡비를 지켜 줄이고 «고지»한다**(v2 :396-400).
 *  **위 상수는 전부 v1→v2 «상속»분이고 이 파일이 새로 정하는 수는 0이다**
 *  (v2 주석이 「실측 아님 · 눈대중 초기값」으로 그 지위를 이미 등재했다 — **그 지위째 상속**한다).
 *
 * ── 옮기지 «않은» 것과 사유(집행 «전» 등재) ────────────────────────────────
 *  · **`garmentRegion` 상대 승계**(v2 :384-386) — 입력이 **업로드 크롭 «메타»**다.
 *    v3 의 프린트 원본은 **저장소 자산 파일**이라 그 메타가 **원리적으로 없다** ⟹
 *    v2 도 그때 쓰는 **«폴백» 경로**(`?autofit=1` · v1 경로)를 그대로 탄다. **경로 선택이지 누락이 아니다.**
 *  · **성분별 «개별 배치»(P34)** — `garmentRegion` 상대 승계 «위에서» 각 성분을 제 자리로 옮기는
 *    정련이다. 폴백 경로에는 **옮길 상대 좌표가 없다** ⟹ **적용 대상이 없다**.
 *
 * ── **판독 정정 1건(구현 «전» · 커밋 «전»)** ───────────────────────────────
 *  1차 판독에서 **재스캔 G2′(78회차)도 «상대 승계 위의 정련»**으로 분류해 «옮기지 않음»에 넣었다.
 *  **틀렸다.** 실행으로 드러났다 — 이 자산에서 **프레임 문턱이 «발동»해 프린트가 통째로 버려졌다**.
 *  v2 주석(`:203-208`)이 그 사태를 정확히 적어 두었다: 「배경이 통째로 «프린트»로 잡혀 bbox 가
 *  프레임 전체가 된다 … **색으로는 못 가른다** … 그래서 **위상**을 쓴다: 후보 화소를 **8-연결 성분**으로
 *  나누고 **프레임 «경계에 닿는» 성분을 제외**한다(배경은 정의상 경계에 닿는다). **새 상수 0**」.
 *  ⟹ **재스캔은 `garmentRegion` 과 «무관»하고 bbox «자체»를 고친다** ⟹ **④ 로 옮긴다**.
 *  (구현을 커밋하기 «전»에 고쳤다 — 결과에 맞춘 조정이 아니라 **계약 판독 오류의 정정**이다.)
 *
 *  ④ **재스캔 G2′** — 1패스 bbox 가 프레임 문턱에 걸리면, 후보 화소를 **8-연결 성분**으로 나누고
 *    **경계에 닿는 성분을 제외**한 뒤 **남은 성분의 합집합 bbox** 를 쓴다. **새 상수 0 · 문턱 0.**
 *    재스캔 후에도 걸리면 **기존대로 프린트를 버린다**(v2 :208).
 *
 * 순수성: `node:` 0 · 파일 0 · `process` 0. **DOM canvas 는 쓴다**(표시 층 산출물이다).
 */

/** v1→v2 상속 상수 — **이 파일이 정하는 수는 0**이다(출처는 위 주석). */
const BORDER_BAND_FRACTION = 0.08;
const BUCKET = 24;
const PRINT_COLOR_DIST_THRESHOLD = 55;
const PRINT_MAX_FRAME_FRACTION = 0.9;
const PRINT_WIDTH_FRACTION = 0.45;
const PRINT_TOP_FRACTION = 0.25;
const OUTPUT_SIZE = 512;
const SCAN_SIZE = 256;

export type Rgb = { r: number; g: number; b: number };
export type CompositeResult = {
  canvas: HTMLCanvasElement;
  /** 대표색 — 뒤판·소매·브리지가 «같은 색»을 쓴다. */
  color: Rgb;
  /** 프린트 bbox(원본 화소) · 없으면 무지. */
  printBox: { x: number; y: number; w: number; h: number } | null;
  /** 프레임 비율 문턱이 걸렸는가(프린트 버림). */
  maxFrameFired: boolean;
  /** 하단 초과로 줄였는가 — «조용히 넘기지 않는다». */
  shrunk: number | null;
  /** 재스캔 G2′ — 성분 수와 «경계 접촉으로 제외한» 수. 미발동이면 null. */
  rescan: { components: number; excluded: number } | null;
};

/** ① 대표색 — 테두리 띠의 최빈 색 버킷 평균(v2 `:43-100` 문언 그대로). */
export function borderRepresentativeColor(img: CanvasImageSource, w: number, h: number): Rgb {
  const FALLBACK: Rgb = { r: 128, g: 128, b: 128 };
  if (!w || !h) return FALLBACK;
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  if (!ctx) return FALLBACK;
  ctx.drawImage(img, 0, 0);                              // 리샘플 없이 원본 해상도 그대로
  let data: Uint8ClampedArray;
  try { data = ctx.getImageData(0, 0, w, h).data; } catch { return FALLBACK; }
  const bandX = Math.round(w * BORDER_BAND_FRACTION), bandY = Math.round(h * BORDER_BAND_FRACTION);
  const buckets = new Map<string, { r: number; g: number; b: number; count: number }>();
  for (let y = 0; y < h; y++) {
    const inBorderRow = y < bandY || y >= h - bandY;
    for (let x = 0; x < w; x++) {
      if (!inBorderRow && x >= bandX && x < w - bandX) continue;   // 중앙 — 건너뜀
      const i = (y * w + x) * 4;
      if (data[i + 3] < 10) continue;                              // 투명
      const r = data[i], g = data[i + 1], b = data[i + 2];
      if (r > 235 && g > 235 && b > 235) continue;                 // 흰 배경/여백
      const key = `${Math.floor(r / BUCKET)},${Math.floor(g / BUCKET)},${Math.floor(b / BUCKET)}`;
      const e = buckets.get(key);
      if (e) { e.r += r; e.g += g; e.b += b; e.count += 1; }
      else buckets.set(key, { r, g, b, count: 1 });
    }
  }
  let best: { r: number; g: number; b: number; count: number } | null = null;
  for (const e of buckets.values()) if (!best || e.count > best.count) best = e;
  if (!best) return FALLBACK;
  return { r: best.r / best.count, g: best.g / best.count, b: best.b / best.count };
}

/** ② 프린트 bbox — 대표색과 거리 > 문턱인 화소의 bbox(원본 화소 좌표). */
function findPrintBox(img: CanvasImageSource, srcW: number, srcH: number, color: Rgb) {
  const cv = document.createElement('canvas');
  cv.width = SCAN_SIZE; cv.height = SCAN_SIZE;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  if (!ctx) return { box: null, fired: false, rescan: null };
  ctx.drawImage(img, 0, 0, SCAN_SIZE, SCAN_SIZE);
  let data: Uint8ClampedArray;
  try { data = ctx.getImageData(0, 0, SCAN_SIZE, SCAN_SIZE).data; }
  catch { return { box: null, fired: false, rescan: null }; }
  const mask = new Uint8Array(SCAN_SIZE * SCAN_SIZE);
  let minX = SCAN_SIZE, minY = SCAN_SIZE, maxX = -1, maxY = -1;
  for (let y = 0; y < SCAN_SIZE; y++) for (let x = 0; x < SCAN_SIZE; x++) {
    const i = (y * SCAN_SIZE + x) * 4;
    if (data[i + 3] < 10) continue;
    const dr = data[i] - color.r, dg = data[i + 1] - color.g, db = data[i + 2] - color.b;
    if (Math.hypot(dr, dg, db) <= PRINT_COLOR_DIST_THRESHOLD) continue;
    mask[y * SCAN_SIZE + x] = 1;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  if (maxX < 0) return { box: null, fired: false, rescan: null };
  const sx = srcW / SCAN_SIZE, sy = srcH / SCAN_SIZE;
  const mk = (aX: number, aY: number, bX: number, bY: number) =>
    ({ x: aX * sx, y: aY * sy, w: (bX - aX + 1) * sx, h: (bY - aY + 1) * sy });
  const over = (b: { w: number; h: number }) =>
    b.w >= srcW * PRINT_MAX_FRAME_FRACTION || b.h >= srcH * PRINT_MAX_FRAME_FRACTION;
  const box = mk(minX, minY, maxX, maxY);
  if (!over(box)) return { box, fired: false, rescan: null };

  /* ④ 재스캔 G2′ — 8-연결 성분에서 «경계에 닿는» 성분을 뺀다(배경은 정의상 경계에 닿는다).
   * **색 술어·새 문턱 0** — 쓰는 것은 «위상»뿐이다(v2 :203-208 문언 그대로). */
  const label = new Int32Array(SCAN_SIZE * SCAN_SIZE).fill(-1);
  const stack: number[] = [];
  let nComp = 0, nExcluded = 0;
  let rMinX = SCAN_SIZE, rMinY = SCAN_SIZE, rMaxX = -1, rMaxY = -1;
  for (let start = 0; start < mask.length; start++) {
    if (mask[start] === 0 || label[start] !== -1) continue;
    const id = nComp++;
    let touchesEdge = false;
    let cMinX = SCAN_SIZE, cMinY = SCAN_SIZE, cMaxX = -1, cMaxY = -1;
    label[start] = id; stack.length = 0; stack.push(start);
    while (stack.length > 0) {
      const cur = stack.pop() as number;
      const cx = cur % SCAN_SIZE, cy = (cur / SCAN_SIZE) | 0;
      if (cx === 0 || cy === 0 || cx === SCAN_SIZE - 1 || cy === SCAN_SIZE - 1) touchesEdge = true;
      if (cx < cMinX) cMinX = cx; if (cx > cMaxX) cMaxX = cx;
      if (cy < cMinY) cMinY = cy; if (cy > cMaxY) cMaxY = cy;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= SCAN_SIZE || ny >= SCAN_SIZE) continue;
        const ni = ny * SCAN_SIZE + nx;
        if (mask[ni] === 0 || label[ni] !== -1) continue;
        label[ni] = id; stack.push(ni);
      }
    }
    if (touchesEdge) { nExcluded++; continue; }
    if (cMinX < rMinX) rMinX = cMinX; if (cMaxX > rMaxX) rMaxX = cMaxX;
    if (cMinY < rMinY) rMinY = cMinY; if (cMaxY > rMaxY) rMaxY = cMaxY;
  }
  const rescan = { components: nComp, excluded: nExcluded };
  if (rMaxX < 0) return { box: null, fired: true, rescan };          // 남은 성분 없음
  const rbox = mk(rMinX, rMinY, rMaxX, rMaxY);
  if (over(rbox)) return { box: null, fired: true, rescan };          // 재스캔 후에도 걸린다 — 버린다
  return { box: rbox, fired: false, rescan };
}

/**
 * 합성 — **대표색으로 전면을 칠하고 «가슴 영역»에만 프린트를 얹는다**.
 * 뒤판·소매·브리지는 부르는 쪽이 **같은 `color`** 를 단색으로 쓴다.
 */
export function compositePrint(img: CanvasImageSource, srcW: number, srcH: number, uMax: number): CompositeResult {
  const color = borderRepresentativeColor(img, srcW, srcH);
  const canvas = document.createElement('canvas');
  canvas.width = OUTPUT_SIZE; canvas.height = OUTPUT_SIZE;
  const ctx = canvas.getContext('2d');
  const out: CompositeResult = { canvas, color, printBox: null, maxFrameFired: false, shrunk: null, rescan: null };
  if (!ctx) return out;
  ctx.fillStyle = `rgb(${color.r}, ${color.g}, ${color.b})`;
  ctx.fillRect(0, 0, OUTPUT_SIZE, OUTPUT_SIZE);          // ← 「앞판 가슴 «밖»도 대표색」
  if (!srcW || !srcH) return out;
  const { box, fired, rescan } = findPrintBox(img, srcW, srcH, color);
  out.maxFrameFired = fired; out.rescan = rescan;
  out.printBox = box;
  if (!box) return out;                                   // 무지 — 대표색만
  /* ③ 배치(폴백 경로) — `garmentRegion` 이 없으므로 v2 도 이 경로를 탄다(위 주석). */
  const panelW = OUTPUT_SIZE * uMax;
  const aspect = box.w / box.h;
  let destW = panelW * PRINT_WIDTH_FRACTION;
  let destH = destW / aspect;
  let destX = (panelW - destW) / 2;
  const destY = OUTPUT_SIZE * PRINT_TOP_FRACTION;
  const maxH = OUTPUT_SIZE - destY;
  if (destH > maxH) {                                     // 하단 초과 금지 — «고지»한다
    const shrink = maxH / destH;
    destH = maxH; destW *= shrink; destX = (panelW - destW) / 2;
    out.shrunk = shrink;
  }
  ctx.drawImage(img, box.x, box.y, box.w, box.h, destX, destY, destW, destH);
  return out;
}
