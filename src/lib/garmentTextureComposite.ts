import * as THREE from "three";

// 46번(전면 재설계) 이후 몸판 텍스처는 사진 전체를 몸판 UV 0~1에 그대로
// 늘려 붙였다 — 소매까지 사진 배경/여백이 통째로 감기고, 프린트 그래픽도
// 실제 인쇄 비율과 무관하게 몸판 치수에 맞춰 늘어나 보이는 문제가 있었다.
// 대신 몸판 전체를 원단 대표색(averageGarmentColor, garmentColor.ts —
// 이 파일에서는 그대로 가져다 쓰기만 하고 수정하지 않는다)으로 칠하고,
// 그 위에 실제 프린트 영역만 원본 비율 그대로 가슴 중앙에 합성한다 —
// 소매는 이 캔버스의 프린트 영역 바깥(대표색 그대로)을 그대로 물려받으므로
// 별도 처리가 필요 없다.

// 프린트 인식 스캔 해상도 — averageGarmentColor(64x64)보다 살짝 높여
// 경계 박스를 더 촘촘히 잡는다. 실측 아님, 성능/정밀도 절충으로 고른
// 눈대중 값.
const SCAN_SIZE = 128;

// 대표색과의 RGB 유클리드 거리가 이보다 크면 "프린트(원단과 다른 색)"로
// 본다 — averageGarmentColor의 배경 판정 임계값(40)보다 살짝 높여, 원단
// 자체의 음영/직조 노이즈까지 프린트로 오인하지 않게 한다. 실측 아님,
// 눈대중 초기값.
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
function findPrintBoundingBox(
  image: HTMLImageElement,
  srcW: number,
  srcH: number,
  color: THREE.Color,
): PrintBox | null {
  const scanCanvas = document.createElement("canvas");
  scanCanvas.width = SCAN_SIZE;
  scanCanvas.height = SCAN_SIZE;
  const ctx = scanCanvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(image, 0, 0, SCAN_SIZE, SCAN_SIZE);
  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(0, 0, SCAN_SIZE, SCAN_SIZE).data;
  } catch {
    return null; // cross-origin 오염 등 — 안전하게 "프린트 없음"으로 취급.
  }

  const r0 = color.r * 255;
  const g0 = color.g * 255;
  const b0 = color.b * 255;

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
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  if (maxX < 0) return null;

  const scaleX = srcW / SCAN_SIZE;
  const scaleY = srcH / SCAN_SIZE;
  const box: PrintBox = {
    x: minX * scaleX,
    y: minY * scaleY,
    w: (maxX - minX + 1) * scaleX,
    h: (maxY - minY + 1) * scaleY,
  };
  if (box.w >= srcW * PRINT_MAX_FRAME_FRACTION || box.h >= srcH * PRINT_MAX_FRAME_FRACTION) return null;
  return box;
}

// 몸판 전체를 대표색으로 칠하고, 실제 프린트 영역(있다면)만 원본 비율
// 그대로 가슴 중앙에 합성한 캔버스를 반환한다.
export function compositeGarmentTexture(image: HTMLImageElement, representativeColor: THREE.Color): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = OUTPUT_SIZE;
  canvas.height = OUTPUT_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  ctx.fillStyle = `#${representativeColor.getHexString()}`;
  ctx.fillRect(0, 0, OUTPUT_SIZE, OUTPUT_SIZE);

  const srcW = image.naturalWidth || image.width;
  const srcH = image.naturalHeight || image.height;
  if (!srcW || !srcH) return canvas;

  const printBox = findPrintBoundingBox(image, srcW, srcH, representativeColor);
  if (!printBox) return canvas;

  const printAspect = printBox.w / printBox.h;
  const destW = OUTPUT_SIZE * PRINT_WIDTH_FRACTION;
  const destH = destW / printAspect;
  const destX = (OUTPUT_SIZE - destW) / 2;
  const destY = OUTPUT_SIZE * PRINT_TOP_FRACTION;
  ctx.drawImage(image, printBox.x, printBox.y, printBox.w, printBox.h, destX, destY, destW, destH);

  return canvas;
}
