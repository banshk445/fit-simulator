import { create } from "zustand";
import type { FabricType } from "../lib/fabricPresets";

interface BodySize {
  height: number; // cm
  chest: number; // cm (둘레)
  armLength: number; // cm
  legLength: number; // cm
  shoulderWidth: number; // cm
}

// 36번(큰 재설계): 예전엔 총장/품 두 개만 있었다 — 어깨너비/소매길이/
// 소매통은 전부 몸 치수에서 자동 계산되거나(소매 길이, 어깨너비) 고정
// 상수였다(소매통). 이러면 사용자가 실제 옷의 실측(어깨너비, 소매길이,
// 소매통)을 입력해 "이 옷을 입으면 내 몸에 짧은지/좁은지"를 확인하는 게
// 애초에 불가능했다 — 옷이 항상 몸에 맞춰 스스로 조정됐기 때문. 실제
// 쇼핑몰 옷 실측표(총장/어깨너비/가슴단면=품/소매길이/소매단면=소매통)와
// 같은 필드 구성으로 맞춘다.
interface GarmentSize {
  length: number; // cm (총장)
  width: number; // cm (품 = 가슴단면)
  shoulderWidth: number; // cm (어깨너비 — 몸 어깨너비와 별개인 옷 자체의 치수)
  sleeveLength: number; // cm (소매길이 — 반팔/긴팔 공통, 몸 팔길이와 무관)
  sleeveWidth: number; // cm (소매통 — 소매 둘레의 평면 실측, 반지름=이 값/2)
}

export type SleeveType = "short" | "long";

interface FitState {
  bodySize: BodySize;
  garmentSize: GarmentSize;
  garmentImage: string | null;
  fabric: FabricType;
  sleeveType: SleeveType;
  // 47번(디버그 전용): garmentWorker가 실제로 충돌 계산에 쓰는 팔 캡슐을
  // 와이어프레임으로 겹쳐 그려 눈으로 검증하기 위한 토글 — dev 빌드에서만
  // 노출된다(Controls.tsx/FitCanvas.tsx에서 import.meta.env.DEV로 감쌈).
  showArmCapsules: boolean;
  setShowArmCapsules: (show: boolean) => void;
  // 47번(디버그 전용): 앞판 렌더 지오메트리를 텍스처 대신 와이어프레임으로
  // 그려, 목선 아래 회색 구간에 실제로 옷감 정점이 있는지(찢어짐/구멍인지
  // 원단 자체가 있는지)를 눈으로 구분하기 위한 토글 — showArmCapsules와
  // 같은 dev 전용 노출 방식.
  showFrontWireframe: boolean;
  setShowFrontWireframe: (show: boolean) => void;
  // 47번(디버그 전용): showFrontWireframe과 같은 방식(단색 와이어프레임
  // 머티리얼 교체)으로, 몸통/소매를 따로 색칠해 영역별로 독립적으로
  // 켜고 끌 수 있게 한 토글 3개 — 뒤판 몸통(파랑), 앞판 소매(빨강),
  // 뒤판 소매(주황). 앞판 몸통은 기존 showFrontWireframe(초록)이 이미
  // 전체 앞판을 덮으므로 별도 항목을 만들지 않는다.
  showBackTorsoWireframe: boolean;
  setShowBackTorsoWireframe: (show: boolean) => void;
  showFrontSleeveWireframe: boolean;
  setShowFrontSleeveWireframe: (show: boolean) => void;
  showBackSleeveWireframe: boolean;
  setShowBackSleeveWireframe: (show: boolean) => void;
  // 47번(디버그 전용 — 진단용 "전 영역 표시"): 위 4개 토글을 개별로 켜는 대신,
  // 몸통/소매 x 앞/뒤 4구역을 동시에 각자 색으로 그리고 원본 텍스처는
  // 완전히 꺼서(오버레이가 아니라 교체) 어느 구역에도 안 속하는 정점이
  // 있으면 검은 픽셀로 바로 드러나게 하는 진단 모드.
  showAllRegionsWireframe: boolean;
  setShowAllRegionsWireframe: (show: boolean) => void;
  // 47번(일반 기능, DEV 아님): 옷감 정점마다 몸 표면까지의 여유(cm)를
  // 색으로 보여주는 핏 맵 — 켜지면 텍스처 대신 이 색으로 렌더한다.
  showFitMap: boolean;
  setShowFitMap: (show: boolean) => void;
  // 렌더 드레이프 개선(레버 1): 물리 격자(44x28)는 그대로 두고 렌더 지오메트리만
  // GPU 쌍선형 텍스처 샘플링으로 세분화(RENDER_SUBDIV)하는 기존 파이프라인의
  // on/off 토글 — 끄면 물리 격자 해상도 그대로 렌더(원복 비교용), dev 전용.
  renderSmoothing: boolean;
  setRenderSmoothing: (show: boolean) => void;
  // M1(신 코어): 암홀 링 정점 용접 + physIndex 직결 렌더(DataTexture 프록시
  // 미사용) 경로 토글 — 신구 대조용, dev 전용. 끄면 기존 경로 그대로.
  newCore: boolean;
  setNewCore: (on: boolean) => void;
  // M2: SDF 접선 마찰 — 신 코어 안에서 마찰만 독립 on/off(A/B 판정용).
  friction: boolean;
  setFriction: (on: boolean) => void;
  setFabric: (fabric: FabricType) => void;
  setBodyHeight: (height: number) => void;
  setBodyChest: (chest: number) => void;
  setArmLength: (armLength: number) => void;
  setLegLength: (legLength: number) => void;
  setShoulderWidth: (shoulderWidth: number) => void;
  setGarmentLength: (length: number) => void;
  setGarmentWidth: (width: number) => void;
  setGarmentShoulderWidth: (shoulderWidth: number) => void;
  setGarmentSleeveLength: (sleeveLength: number) => void;
  setGarmentSleeveWidth: (sleeveWidth: number) => void;
  setGarmentImage: (url: string | null) => void;
  setSleeveType: (sleeveType: SleeveType) => void;
}

// 표준 체형 기준값. Mannequin.tsx는 이 기본값 대비 현재값의 "배율"로
// 뼈대를 스케일하므로, 모델의 실제 뼈대 길이를 몰라도 안전하게 동작한다.
export const DEFAULT_BODY_SIZE: BodySize = {
  height: 170,
  chest: 100,
  armLength: 60,
  legLength: 85,
  shoulderWidth: 45,
};

// 반팔/긴팔 기본 소매길이. 실제 반팔 티셔츠는 대략 20~24cm, 긴팔은
// 55~60cm 안팎이라 두 값의 차이가 크다 — 소매 종류를 바꿀 때 이전
// 값이 새 종류에 명백히 안 맞으면(예: 긴팔로 바꿨는데 소매길이가 22cm
// 그대로면 팔뚝 중간에서 끝나는 이상한 긴팔이 됨) 아래 setSleeveType이
// 이 기본값으로 리셋한다. 사용자가 그 뒤 직접 조정한 값은 그대로 유지된다.
const DEFAULT_SLEEVE_LENGTH_SHORT = 22;
const DEFAULT_SLEEVE_LENGTH_LONG = 58;

export const useFitStore = create<FitState>((set) => ({
  bodySize: { ...DEFAULT_BODY_SIZE },
  garmentSize: {
    length: 70,
    // 36번 배포 직후 발견한 회귀: 이전 기본값(110)은 앞판 "패널 하나"의
    // 전체 폭으로 그대로 쓰이는데(buildGarmentSim.ts의 halfWidthAtRow —
    // fullHalfWidth = widthM/2, 앞판·뒤판 각각 독립적으로 이 폭을 씀),
    // 실제 가슴단면(품)은 가슴둘레의 절반 안팎이 정상이라(100cm 가슴둘레
    // 기준 약 50~55cm) 110은 애초에 실측 관례에 안 맞는 값이었다 — 그동안
    // "이미지 비율에 맞춰 박스 안에 맞추기" 버그(Garment.tsx, 36번에서
    // 제거함)가 이 값을 사진 비율에 따라 몰래 훨씬 작게(약 58cm) 줄이고
    // 있어서 우연히 정상 범위로 보였을 뿐이다. 그 버그를 고치자 110이
    // 그대로 적용돼 어깨(핀 반폭 약 29.5cm)에서 겨드랑이(55cm 반폭)까지
    // 거의 두 배로 벌어지는 극단적인 테이퍼가 되어, 어깨가 붕 뜨고
    // 목선이 가슴 쪽으로 무너지는 것처럼 보였다(실측: 사용자 스크린샷).
    // 실제 가슴단면 관례에 맞춰 55로 되돌린다.
    width: 55,
    shoulderWidth: 45,
    sleeveLength: DEFAULT_SLEEVE_LENGTH_SHORT,
    sleeveWidth: 18,
  },
  garmentImage: null,
  fabric: "cotton",
  sleeveType: "short",
  showArmCapsules: false,
  setShowArmCapsules: (show) => set({ showArmCapsules: show }),
  showFrontWireframe: false,
  setShowFrontWireframe: (show) => set({ showFrontWireframe: show }),
  showBackTorsoWireframe: false,
  setShowBackTorsoWireframe: (show) => set({ showBackTorsoWireframe: show }),
  showFrontSleeveWireframe: false,
  setShowFrontSleeveWireframe: (show) => set({ showFrontSleeveWireframe: show }),
  showBackSleeveWireframe: false,
  setShowBackSleeveWireframe: (show) => set({ showBackSleeveWireframe: show }),
  showAllRegionsWireframe: false,
  setShowAllRegionsWireframe: (show) => set({ showAllRegionsWireframe: show }),
  showFitMap: false,
  setShowFitMap: (show) => set({ showFitMap: show }),
  renderSmoothing: true,
  setRenderSmoothing: (show) => set({ renderSmoothing: show }),
  newCore: false,
  setNewCore: (on) => set({ newCore: on }),
  friction: true,
  setFriction: (on) => set({ friction: on }),
  setFabric: (fabric) => set({ fabric }),
  setBodyHeight: (height) => set((state) => ({ bodySize: { ...state.bodySize, height } })),
  setBodyChest: (chest) => set((state) => ({ bodySize: { ...state.bodySize, chest } })),
  setArmLength: (armLength) => set((state) => ({ bodySize: { ...state.bodySize, armLength } })),
  setLegLength: (legLength) => set((state) => ({ bodySize: { ...state.bodySize, legLength } })),
  setShoulderWidth: (shoulderWidth) =>
    set((state) => ({ bodySize: { ...state.bodySize, shoulderWidth } })),
  setGarmentLength: (length) => set((state) => ({ garmentSize: { ...state.garmentSize, length } })),
  setGarmentWidth: (width) => set((state) => ({ garmentSize: { ...state.garmentSize, width } })),
  setGarmentShoulderWidth: (shoulderWidth) =>
    set((state) => ({ garmentSize: { ...state.garmentSize, shoulderWidth } })),
  setGarmentSleeveLength: (sleeveLength) =>
    set((state) => ({ garmentSize: { ...state.garmentSize, sleeveLength } })),
  setGarmentSleeveWidth: (sleeveWidth) =>
    set((state) => ({ garmentSize: { ...state.garmentSize, sleeveWidth } })),
  setGarmentImage: (garmentImage) => set({ garmentImage }),
  setSleeveType: (sleeveType) =>
    set((state) => {
      const len = state.garmentSize.sleeveLength;
      // 명백히 반대 종류의 값(반팔인데 40cm 넘음, 긴팔인데 40cm 미만)일
      // 때만 기본값으로 리셋 — 사용자가 일부러 짧은 긴팔/긴 반팔을
      // 만들어둔 경우(그 자체가 의도된 핏 실험일 수 있음)는 건드리지 않는다.
      const needsReset = sleeveType === "short" ? len > 40 : len < 40;
      if (!needsReset) return { sleeveType };
      const sleeveLength = sleeveType === "short" ? DEFAULT_SLEEVE_LENGTH_SHORT : DEFAULT_SLEEVE_LENGTH_LONG;
      return { sleeveType, garmentSize: { ...state.garmentSize, sleeveLength } };
    }),
}));

// DEV 전용: 콘솔 측정 워크플로우(__fitDebug 계열)에서 이미지 업로드 UI를
// 거치지 않고 상태를 조작할 수 있게 스토어를 노출한다 — 예:
// window.__fitStore.getState().setGarmentImage(dataUrl).
if (import.meta.env.DEV) {
  (window as unknown as { __fitStore?: typeof useFitStore }).__fitStore = useFitStore;

  // 화면 판정 자립 워크플로우: 쿼리 파라미터로 페이지 로드 시 상태를
  // 자동 복원한다 — vite 재시작(라이브 리로드) 후에도 콘솔 조작 없이
  // 항상 같은 판정 상태로 돌아오게. 예:
  //   localhost:5173/?autofit=1&newcore=1        (신 코어 판정 상태)
  //   localhost:5173/?autofit=1&newcore=1&friction=0  (마찰 A/B)
  const q = new URLSearchParams(window.location.search);
  if (q.get("autofit") === "1") {
    const canvas = document.createElement("canvas");
    canvas.width = 400;
    canvas.height = 400;
    const g = canvas.getContext("2d");
    if (g) {
      g.fillStyle = "#3a6ea5";
      g.fillRect(0, 0, 400, 400);
      useFitStore.getState().setGarmentImage(canvas.toDataURL());
    }
  }
  if (q.get("newcore") === "1") useFitStore.getState().setNewCore(true);
  if (q.get("friction") === "0") useFitStore.getState().setFriction(false);
  if (q.get("smoothing") === "0") useFitStore.getState().setRenderSmoothing(false);
  if (q.get("fitmap") === "1") useFitStore.getState().setShowFitMap(true);
  // 데모 경로 실주행·문턱 실측용: 치수를 쿼리로 넣는다. 슬라이더를
  // 손으로 옮기지 않고도 같은 조합을 다시 재현할 수 있어야 "사이즈 변경
  // 시 드레이프가 실제로 달라지는가"를 전후 대조할 수 있다.
  const chest = q.get("chest");
  if (chest) useFitStore.getState().setBodyChest(Number(chest));
  const width = q.get("width");
  if (width) useFitStore.getState().setGarmentWidth(Number(width));
  const pinlift = q.get("pinlift");
  if (pinlift) {
    void import("../lib/shoulderPin").then((m) => m.setShoulderPinLiftOverride(Number(pinlift) / 100));
  }
}
