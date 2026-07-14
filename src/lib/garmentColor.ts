import * as THREE from "three";

// 소매는 원통이라 옷 이미지 전체를 UV 한 바퀴(0~1)에 그대로 감으면, 실제
// 상품 사진의 배경까지 통째로 감겨서 몸판(원단 고유색)과 전혀 안 맞는 색
// 줄무늬가 생긴다(실측 확인 — 검은 티셔츠인데 소매만 흰 줄무늬가 두드러져
// 다른 옷을 걸친 것처럼 보였다). 소매까지 그래픽을 정확히 이어 붙이는 건
// 실제 CLO3D급 UV 전개 없이는 불가능하므로, 대신 이미지에서 대표색 하나를
// 뽑아 소매를 그 단색으로 칠한다.
//
// 처음엔 "거의 흰색(235+)"만 배경으로 보고 제외한 뒤 나머지 픽셀의
// 평균을 냈는데, 두 가지 문제가 실측으로 드러났다:
// 1) 티셔츠 중앙의 큼직한 컬러 그래픽(빨강/주황 등)이 평균을 그쪽으로
//    끌어당겨 몸판(검정)과 소매(그래픽에 물든 갈색조)가 달라 보였다 —
//    단순 평균 대신 최빈값(거친 RGB 버킷)으로 바꿔 해결.
// 2) 모델이 입고 촬영한 라이프스타일 사진(흰색이 아니라 회색 스튜디오
//    배경, 팔다리·청바지 등 옷이 아닌 영역이 프레임 대부분을 차지)으로
//    테스트해보니, 235 임계값이 회색 배경을 못 걸러내 배경색이 최빈값을
//    차지해버려 소매가 셔츠 색(검정)이 아니라 베이지색으로 나왔다.
//    "흰색"이라는 고정 임계값 대신, 이미지 네 귀퉁이 픽셀을 실제
//    배경색 추정치로 삼아 그 색과 가까운 픽셀을 배경으로 제외하고,
//    샘플링 자체도 프레임 가장자리보다 옷이 있을 가능성이 높은 중앙
//    영역으로 좁혀 배경/피부/다른 의류의 오염을 줄인다.
export function averageGarmentColor(image: HTMLImageElement | ImageBitmap): THREE.Color {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return new THREE.Color(0x808080);

  ctx.drawImage(image, 0, 0, size, size);
  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(0, 0, size, size).data;
  } catch {
    // 캔버스가 오염돼(cross-origin) 픽셀을 못 읽는 경우의 안전한 폴백.
    return new THREE.Color(0x808080);
  }

  const pixelAt = (x: number, y: number) => {
    const i = (y * size + x) * 4;
    return { r: data[i], g: data[i + 1], b: data[i + 2], a: data[i + 3] };
  };

  // 네 귀퉁이(각 5x5 블록)의 평균색을 배경색 추정치로 삼는다 — 상품 플랫
  // 촬영이든, 모델이 입고 찍은 스튜디오 사진이든 귀퉁이는 거의 항상
  // 배경이라는 전제(둘 다 이 프로젝트에서 실측으로 확인).
  const corner = 5;
  let bgR = 0;
  let bgG = 0;
  let bgB = 0;
  let bgCount = 0;
  for (const [sx, sy] of [
    [0, 0],
    [size - corner, 0],
    [0, size - corner],
    [size - corner, size - corner],
  ] as const) {
    for (let y = sy; y < sy + corner; y++) {
      for (let x = sx; x < sx + corner; x++) {
        const p = pixelAt(x, y);
        if (p.a < 10) continue;
        bgR += p.r;
        bgG += p.g;
        bgB += p.b;
        bgCount += 1;
      }
    }
  }
  const bg = bgCount > 0 ? { r: bgR / bgCount, g: bgG / bgCount, b: bgB / bgCount } : null;
  const BG_DIST_THRESHOLD = 40; // RGB 유클리드 거리 — 이보다 배경 추정색에 가까우면 배경으로 취급.

  const BUCKET = 24; // 버킷 폭(0~255를 이 값으로 나눠 양자화) — 너무 잘게 쪼개면 최빈값이 무의미해진다.
  const buckets = new Map<string, { r: number; g: number; b: number; count: number }>();
  let fallbackR = 0;
  let fallbackG = 0;
  let fallbackB = 0;
  let fallbackCount = 0;

  // 옷 사진(플랫 촬영이든 모델 착용샷이든)은 보통 프레임 중앙에 있고,
  // 가장자리로 갈수록 배경·손·다른 의류가 섞일 확률이 높다 — 중앙
  // 60% 영역만 표본으로 쓴다.
  const margin = Math.round(size * 0.2);
  for (let y = margin; y < size - margin; y++) {
    for (let x = margin; x < size - margin; x++) {
      const p = pixelAt(x, y);
      if (p.a < 10) continue;
      if (p.r > 235 && p.g > 235 && p.b > 235) continue; // 흰 배경/여백
      if (bg) {
        const d = Math.hypot(p.r - bg.r, p.g - bg.g, p.b - bg.b);
        if (d < BG_DIST_THRESHOLD) continue; // 귀퉁이에서 추정한 배경색과 비슷함
      }

      fallbackR += p.r;
      fallbackG += p.g;
      fallbackB += p.b;
      fallbackCount += 1;

      const key = `${Math.floor(p.r / BUCKET)},${Math.floor(p.g / BUCKET)},${Math.floor(p.b / BUCKET)}`;
      const entry = buckets.get(key);
      if (entry) {
        entry.r += p.r;
        entry.g += p.g;
        entry.b += p.b;
        entry.count += 1;
      } else {
        buckets.set(key, { r: p.r, g: p.g, b: p.b, count: 1 });
      }
    }
  }

  if (fallbackCount === 0) {
    // 중앙 영역이 전부 배경/흰색으로 걸러졌다면(드문 경우), 배경 제외 없이
    // 이미지 전체 평균으로 되돌린다 — 아예 단색을 못 뽑는 것보다 낫다.
    for (let i = 0; i < data.length; i += 4) {
      fallbackR += data[i];
      fallbackG += data[i + 1];
      fallbackB += data[i + 2];
      fallbackCount += 1;
    }
    if (fallbackCount === 0) return new THREE.Color(0x808080);
    return new THREE.Color(fallbackR / fallbackCount / 255, fallbackG / fallbackCount / 255, fallbackB / fallbackCount / 255);
  }

  let best: { r: number; g: number; b: number; count: number } | null = null;
  for (const entry of buckets.values()) {
    if (!best || entry.count > best.count) best = entry;
  }
  if (!best) return new THREE.Color(fallbackR / fallbackCount / 255, fallbackG / fallbackCount / 255, fallbackB / fallbackCount / 255);
  return new THREE.Color(best.r / best.count / 255, best.g / best.count / 255, best.b / best.count / 255);
}
