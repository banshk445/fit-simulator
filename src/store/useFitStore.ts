import { create } from "zustand";
import type { FabricType } from "../lib/fabricPresets";

interface BodySize {
  height: number; // cm
  chest: number; // cm (둘레)
  armLength: number; // cm
  legLength: number; // cm
  shoulderWidth: number; // cm
}

interface GarmentSize {
  length: number; // cm (총장)
  width: number; // cm (품)
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

export const useFitStore = create<FitState>((set) => ({
  bodySize: { ...DEFAULT_BODY_SIZE },
  garmentSize: { length: 70, width: 110 },
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
  setGarmentImage: (garmentImage) => set({ garmentImage }),
  setSleeveType: (sleeveType) => set({ sleeveType }),
}));
