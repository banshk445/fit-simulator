// 업로드한 옷 이미지가 플랫레이/고스트 마네킹 상품샷이 아니라 모델이
// 실제로 입고 찍은 라이프스타일 사진이면, 몸판 텍스처가 사진 전체(배경,
// 얼굴, 팔다리 피부, 바지 등)를 그대로 늘려 붙여서 마네킹 가슴에 모델
// 얼굴이 비치는 것처럼 보이는 문제가 실측(사용자가 다른 사진으로
// 재검증하며 발견)으로 확인됐다. 정교한 세그멘테이션(ML 기반)은 이
// 프로젝트에 서버/모델 인프라가 없어 과합이므로, 캔버스 픽셀 분석만으로
// "배경 제거 + 얼굴/피부 위쪽 트리밍"을 하는 휴리스틱으로 옷 영역에
// 가깝게 잘라낸다. 완벽하지 않지만(팔다리 옆쪽 노출 피부는 남을 수 있음)
// 가장 눈에 띄는 문제(가슴 한복판에 얼굴이 비치는 것)는 확실히 없앤다.
//
// 플랫레이 사진(배경 없이 옷이 프레임 대부분을 채움)에는 아예 손대지
// 않는다 — 이런 사진은 자를 배경이 마땅히 없어서, 억지로 자르면 오히려
// 옷 가장자리를 잘라먹을 위험만 있다. "전경(배경 아닌 영역)이 프레임의
// 92% 이상"이면 원본을 그대로 돌려준다.

const ANALYSIS_LONG_SIDE = 220;
const BG_DIST_THRESHOLD = 38;
const SKIN_ROW_WINDOW = 5;
const SKIN_ROW_ENTER_FRACTION = 0.4; // 이 이상이면 "얼굴/피부 구간에 들어섰다"고 판단
const SKIN_ROW_EXIT_FRACTION = 0.25; // 이 아래로 내려가면 "피부 구간을 벗어났다"고 판단
const MIN_CONTENT_ROW_FRACTION = 0.03;
const PADDING_FRACTION = 0.04;
const MIN_CROP_AREA_FRACTION = 0.12;
const FULL_FRAME_SKIP_FRACTION = 0.92;

function isSkinTone(r: number, g: number, b: number): boolean {
  // 고전적인 RGB 기반 피부색 판별 규칙(Peer et al.) — 조명/인종에 따라
  // 완벽하진 않지만 가볍고 별도 모델이 필요 없다.
  const maxC = Math.max(r, g, b);
  const minC = Math.min(r, g, b);
  return r > 95 && g > 40 && b > 20 && maxC - minC > 15 && Math.abs(r - g) > 15 && r > g && r > b;
}

// 사각형 크롭만으로는 옷과 같은 열(column)에 걸친 팔뚝/손처럼 세로로만
// 다른 영역을 걷어낼 수 없다(예: 어깨 높이는 셔츠 원단이라 유효한 열로
// 인정되지만, 그 아래로는 같은 열에 노출된 팔뚝이 있는 경우) — 크롭 후
// 최종 이미지에서 피부색 픽셀을 원단 대표색으로 덮어 칠해서 보완한다.
// 대표색은 크롭 영역 안의 "전경이면서 피부가 아닌" 픽셀의 최빈값(거친
// RGB 버킷)으로 뽑는다(garmentColor.ts의 대표색 추출과 같은 방식).
function computeDominantColor(
  fg: Uint8Array,
  skin: Uint8Array,
  data: Uint8ClampedArray,
  aw: number,
  box: Box,
): { r: number; g: number; b: number } | null {
  const BUCKET = 24;
  const buckets = new Map<string, { r: number; g: number; b: number; count: number }>();
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let count = 0;
  for (let y = box.top; y <= box.bottom; y++) {
    for (let x = box.left; x <= box.right; x++) {
      const idx = y * aw + x;
      if (!fg[idx] || skin[idx]) continue;
      const i = idx * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      sumR += r;
      sumG += g;
      sumB += b;
      count += 1;
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
  if (count === 0) return null;
  let best: { r: number; g: number; b: number; count: number } | null = null;
  for (const entry of buckets.values()) {
    if (!best || entry.count > best.count) best = entry;
  }
  if (!best) return { r: sumR / count, g: sumG / count, b: sumB / count };
  return { r: best.r / best.count, g: best.g / best.count, b: best.b / best.count };
}

function loadImage(file: File): Promise<{ img: HTMLImageElement; revoke: () => void }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ img, revoke: () => URL.revokeObjectURL(url) });
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("이미지를 불러오지 못했습니다."));
    };
    img.src = url;
  });
}

interface Box {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/**
 * 출력 프레임 «안»에서 옷이 실제로 차지하는 픽셀 박스(P32 §1).
 * `null`이면 옷 영역을 특정하지 못한 것이고, 프린트 상대 좌표를 낼 근거가 없다.
 *
 * **주의(정의역)**: 이 박스는 사진 속 옷의 «외곽»이라 반팔이면 소매를 포함한다.
 * 앞판 패널 폭(품)보다 넓으므로 가로 상대 크기는 그만큼 작게 잡힌다 — P32 §1-3 한계.
 */
export interface GarmentRegion {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CropResult {
  url: string;
  /** 출력 프레임 기준 옷 박스. null = 상대 좌표 산출 불가(폴백) */
  garment: GarmentRegion | null;
}

// 업로드된 옷 이미지 파일을 받아, 배경/얼굴-피부 영역을 제외한 옷 영역
// 위주로 크롭한 새 이미지의 blob URL을 돌려준다. 크롭할 게 마땅치
// 않다고 판단되면(플랫레이 등) 원본 그대로 URL을 만들어 돌려준다.
//
// P32 §1 — 반환 계약을 `{url, garment}`로 넓혔다. 종전에는 «크롭 성공»과
// «분석 실패»가 둘 다 원본 URL 문자열이라 호출자가 구분할 수 없었다(9곳이
// 같은 값을 돌려준다). 프린트 상대 배치는 「프레임이 곧 옷인가」를 알아야
// 성립하므로 그 사실을 값으로 내보낸다. **url 자체는 종전과 비트 동일.**
export async function cropToGarmentRegion(file: File): Promise<CropResult> {
  const { img, revoke } = await loadImage(file);
  const raw = (): CropResult => ({ url: URL.createObjectURL(file), garment: null });
  try {
    const fullW = img.naturalWidth;
    const fullH = img.naturalHeight;
    if (fullW < 4 || fullH < 4) return raw();

    const scale = ANALYSIS_LONG_SIDE / Math.max(fullW, fullH);
    const aw = Math.max(1, Math.round(fullW * scale));
    const ah = Math.max(1, Math.round(fullH * scale));

    const analysisCanvas = document.createElement("canvas");
    analysisCanvas.width = aw;
    analysisCanvas.height = ah;
    const actx = analysisCanvas.getContext("2d");
    if (!actx) return raw();
    actx.drawImage(img, 0, 0, aw, ah);

    let data: Uint8ClampedArray;
    try {
      data = actx.getImageData(0, 0, aw, ah).data;
    } catch {
      // 캔버스 오염(cross-origin) — 분석 불가, 원본을 그대로 쓴다.
      return raw();
    }

    const at = (x: number, y: number) => {
      const i = (y * aw + x) * 4;
      return { r: data[i], g: data[i + 1], b: data[i + 2], a: data[i + 3] };
    };

    // 네 귀퉁이 평균색을 배경색 추정치로 삼는다(garmentColor.ts와 같은 전제).
    const corner = Math.max(2, Math.round(Math.min(aw, ah) * 0.06));
    let bgR = 0;
    let bgG = 0;
    let bgB = 0;
    let bgCount = 0;
    for (const [sx, sy] of [
      [0, 0],
      [aw - corner, 0],
      [0, ah - corner],
      [aw - corner, ah - corner],
    ] as const) {
      for (let y = Math.max(0, sy); y < Math.min(ah, sy + corner); y++) {
        for (let x = Math.max(0, sx); x < Math.min(aw, sx + corner); x++) {
          const p = at(x, y);
          if (p.a < 10) continue;
          bgR += p.r;
          bgG += p.g;
          bgB += p.b;
          bgCount += 1;
        }
      }
    }
    // 네 귀퉁이가 전부 투명(이미 배경 제거된 PNG를 올린 경우)이면 색상
    // 거리로 배경을 추정할 방법이 없다 — 예전엔 이 경우 그냥 원본을 그대로
    // 반환했는데, 그러면 실제 옷 주위의 투명 여백(캔버스 크기 그대로,
    // 흔히 상당히 넓다)이 하나도 안 잘려나간 채 몸판 텍스처 전체에
    // 매핑돼, 어깨~목선 근처에 빈 여백이 넓게 자리잡는 문제가 실측
    // (사용자가 배경 제거된 사진으로 직접 재요청, 원본 그대로 쓰는
    // 정확히 이 경로를 타는 것을 확인)으로 드러났다. 색상 배경 추정이
    // 안 될 뿐 알파 채널 자체가 이미 완벽한 전경/배경 신호이므로, 이
    // 경우엔 색상 비교를 건너뛰고 알파만으로 전경을 가른다(bg를 null로
    // 남겨 아래 fg 계산이 알파만 보게 한다).
    const bg = bgCount > 0 ? { r: bgR / bgCount, g: bgG / bgCount, b: bgB / bgCount } : null;
    if (!bg) {
      let hasOpaquePixel = false;
      for (let i = 3; i < data.length; i += 4) {
        if (data[i] >= 10) {
          hasOpaquePixel = true;
          break;
        }
      }
      if (!hasOpaquePixel) return raw(); // 완전히 빈 이미지 — 분석 불가
    }

    const isBackground = (r: number, g: number, b: number) => {
      if (!bg) return false; // 알파만으로 이미 걸러졌으니 색상 배경 판정은 안 한다.
      if (r > 240 && g > 240 && b > 240) return true;
      return Math.hypot(r - bg.r, g - bg.g, b - bg.b) < BG_DIST_THRESHOLD;
    };

    // 전경(배경 아님) / 피부 마스크를 픽셀 단위로 계산.
    const fg = new Uint8Array(aw * ah);
    const skin = new Uint8Array(aw * ah);
    for (let y = 0; y < ah; y++) {
      for (let x = 0; x < aw; x++) {
        const p = at(x, y);
        const idx = y * aw + x;
        if (p.a < 10 || isBackground(p.r, p.g, p.b)) continue;
        fg[idx] = 1;
        if (isSkinTone(p.r, p.g, p.b)) skin[idx] = 1;
      }
    }

    // 행/열별 전경 비율로 "내용이 있는" 범위(전경 bbox)를 구한다 — 낱개
    // 픽셀 노이즈에 흔들리지 않도록 최소 비율 이상인 행/열만 인정한다.
    const rowFgCount = new Array<number>(ah).fill(0);
    const colFgCount = new Array<number>(aw).fill(0);
    for (let y = 0; y < ah; y++) {
      for (let x = 0; x < aw; x++) {
        if (fg[y * aw + x]) {
          rowFgCount[y] += 1;
          colFgCount[x] += 1;
        }
      }
    }
    let top = -1;
    let bottom = -1;
    for (let y = 0; y < ah; y++) {
      if (rowFgCount[y] / aw > MIN_CONTENT_ROW_FRACTION) {
        if (top === -1) top = y;
        bottom = y;
      }
    }
    let left = -1;
    let right = -1;
    for (let x = 0; x < aw; x++) {
      if (colFgCount[x] / ah > MIN_CONTENT_ROW_FRACTION) {
        if (left === -1) left = x;
        right = x;
      }
    }

    if (top === -1 || left === -1) return raw(); // 전경을 못 찾음(거의 단색 이미지 등)

    const fullFgBox: Box = { top, bottom, left, right };
    const fgArea = (bottom - top + 1) * (right - left + 1);
    if (fgArea / (aw * ah) > FULL_FRAME_SKIP_FRACTION) {
      // 배경 여백이 거의 없는 플랫레이류 — 자를 필요 없음.
      // **P32 §1**: 자르지 않았을 뿐 «전경 bbox = 옷»은 특정돼 있다. 이 경로는
      // 폴백이 아니라 유효분이므로 옷 박스를 원본 해상도로 환산해 함께 낸다
      // (분석 해상도 aw×ah → 원본 fullW×fullH).
      return {
        url: URL.createObjectURL(file),
        garment: {
          x: (left * fullW) / aw,
          y: (top * fullH) / ah,
          w: ((right - left + 1) * fullW) / aw,
          h: ((bottom - top + 1) * fullH) / ah,
        },
      };
    }

    // 위에서부터 훑으며 "피부 비율이 높은 구간(얼굴/목)"을 지나 다시
    // 낮아지는 지점을 찾는다 — 그 지점부터가 옷(어깨선) 시작점이라고 본다.
    let sawSkinBand = false;
    let garmentTop = top;
    for (let y = top; y <= bottom; y++) {
      let winFg = 0;
      let winSkin = 0;
      for (let wy = y; wy < Math.min(y + SKIN_ROW_WINDOW, bottom + 1); wy++) {
        for (let x = left; x <= right; x++) {
          if (fg[wy * aw + x]) {
            winFg += 1;
            if (skin[wy * aw + x]) winSkin += 1;
          }
        }
      }
      const frac = winFg > 0 ? winSkin / winFg : 0;
      if (!sawSkinBand && frac > SKIN_ROW_ENTER_FRACTION) {
        sawSkinBand = true;
      } else if (sawSkinBand && frac < SKIN_ROW_EXIT_FRACTION) {
        garmentTop = y;
        break;
      }
    }
    // 얼굴 구간을 못 찾았으면(sawSkinBand=false) 트리밍하지 않는다 — 원래
    // 전경 bbox의 top을 그대로 쓴다(위 루프가 break 없이 끝나면 garmentTop은
    // top으로 남아 있다).
    if (!sawSkinBand) garmentTop = top;

    // 얼굴 구간을 뺀 나머지(옷 후보) 범위에서 "전경이면서 피부가 아닌"
    // 픽셀만으로 좌/우 경계를 다시 좁혀, 옆으로 노출된 손/팔뚝도 어느
    // 정도 걷어낸다. 얼굴을 못 찾았으면(sawSkinBand=false, 플랫레이 등
    // 사람이 없는 사진일 가능성) 피부 판별 자체를 신뢰할 근거가 없으므로
    // — 예: 곰 캐릭터 그래픽의 갈색 털이 "피부"로 오탐되는 경우 — 제외
    // 없이 전경 전체를 그대로 쓴다.
    const gCol = new Array<number>(aw).fill(0);
    for (let y = garmentTop; y <= bottom; y++) {
      for (let x = left; x <= right; x++) {
        const idx = y * aw + x;
        if (fg[idx] && (!sawSkinBand || !skin[idx])) gCol[x] += 1;
      }
    }
    const rowsInGarment = Math.max(1, bottom - garmentTop + 1);
    let gLeft = -1;
    let gRight = -1;
    for (let x = left; x <= right; x++) {
      if (gCol[x] / rowsInGarment > MIN_CONTENT_ROW_FRACTION) {
        if (gLeft === -1) gLeft = x;
        gRight = x;
      }
    }

    let box: Box;
    if (gLeft !== -1 && gRight > gLeft) {
      box = { top: garmentTop, bottom, left: gLeft, right: gRight };
    } else {
      // 피부 제외 후 좌우 경계를 못 찾았으면(예: 전부 피부로 분류된 극단적
      // 케이스) 얼굴만 트리밍한 범위로 완화.
      box = { top: garmentTop, bottom, left, right };
    }

    const area = (box.bottom - box.top + 1) * (box.right - box.left + 1);
    if (area / (aw * ah) < MIN_CROP_AREA_FRACTION) {
      // 너무 작게 잘리면(휴리스틱이 잘못 판단했을 가능성) 얼굴 트리밍 없는
      // 원래 전경 bbox로 완화하고, 그것도 너무 작으면 원본을 그대로 쓴다.
      const fullArea = (fullFgBox.bottom - fullFgBox.top + 1) * (fullFgBox.right - fullFgBox.left + 1);
      if (fullArea / (aw * ah) < MIN_CROP_AREA_FRACTION) return raw();
      box = fullFgBox;
    }

    // 피부 덮어칠하기(아래 paint-over 단계)도 같은 이유로 얼굴을 실제로
    // 찾았을 때만(sawSkinBand=true) 수행한다 — 사람이 없는 사진에서
    // "피부색"으로 오탐된 그래픽 색상을 지워버리는 사고를 막는다(실측
    // 확인: 곰 캐릭터 그래픽의 갈색 털이 죄다 검게 칠해지는 회귀가
    // 있었다).
    const dominantColor = sawSkinBand ? computeDominantColor(fg, skin, data, aw, box) : null;

    // 여유(패딩) 추가 후 분석 해상도 → 원본 해상도로 스케일.
    const padX = Math.round((box.right - box.left) * PADDING_FRACTION);
    const padY = Math.round((box.bottom - box.top) * PADDING_FRACTION);
    const sxA = Math.max(0, box.left - padX);
    const syA = Math.max(0, box.top - padY);
    const exA = Math.min(aw, box.right + padX + 1);
    const eyA = Math.min(ah, box.bottom + padY + 1);

    const scaleX = fullW / aw;
    const scaleY = fullH / ah;
    const sx = Math.round(sxA * scaleX);
    const sy = Math.round(syA * scaleY);
    const sw = Math.max(1, Math.round((exA - sxA) * scaleX));
    const sh = Math.max(1, Math.round((eyA - syA) * scaleY));

    const outCanvas = document.createElement("canvas");
    outCanvas.width = sw;
    outCanvas.height = sh;
    const octx = outCanvas.getContext("2d");
    if (!octx) return raw();
    octx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);

    // 크롭된 최종 이미지에 남아있는 피부색 픽셀(옆으로 노출된 팔뚝/손 등)을
    // 원단 대표색으로 덮어 칠한다 — 사각형 크롭이 못 걷어낸 부분을 보완.
    if (dominantColor) {
      try {
        const outImageData = octx.getImageData(0, 0, sw, sh);
        const od = outImageData.data;
        for (let i = 0; i < od.length; i += 4) {
          if (isSkinTone(od[i], od[i + 1], od[i + 2])) {
            od[i] = dominantColor.r;
            od[i + 1] = dominantColor.g;
            od[i + 2] = dominantColor.b;
          }
        }
        octx.putImageData(outImageData, 0, 0);
      } catch {
        // 오염된 캔버스라 못 읽으면(cross-origin) 그냥 원래 크롭 그대로 둔다.
      }
    }

    const blob = await new Promise<Blob | null>((resolve) => octx.canvas.toBlob(resolve, "image/png"));
    if (!blob) return raw();
    // **P32 §1**: 출력 프레임은 옷 박스 «+ 패딩»(PADDING_FRACTION 4% · 이미지
    // 가장자리에서는 잘려 비대칭)이다. 상대 좌표를 프레임 기준으로 내면 그
    // 패딩만큼 어긋나므로, 옷 박스를 출력 원점(sx, sy) 기준으로 환산해 낸다.
    return {
      url: URL.createObjectURL(blob),
      garment: {
        x: box.left * scaleX - sx,
        y: box.top * scaleY - sy,
        w: (box.right - box.left + 1) * scaleX,
        h: (box.bottom - box.top + 1) * scaleY,
      },
    };
  } finally {
    revoke();
  }
}
