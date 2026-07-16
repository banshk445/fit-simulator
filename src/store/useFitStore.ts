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
    width: 110,
    shoulderWidth: 45,
    sleeveLength: DEFAULT_SLEEVE_LENGTH_SHORT,
    sleeveWidth: 18,
  },
  garmentImage: null,
  fabric: "cotton",
  sleeveType: "short",
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
