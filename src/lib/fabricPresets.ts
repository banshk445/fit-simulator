export type FabricType = "cotton" | "denim" | "silk" | "knit";

export interface FabricPreset {
  label: string;
  // 중력에 곱하는 배율 — 원단이 무거울수록 몸에 더 밀착해서 처진다.
  gravityScale: number;
  // Verlet 속도 감쇠 유지율(1에 가까울수록 에너지 손실이 적어 하늘거리고,
  // 낮을수록 진동이 빨리 죽어 뻣뻣/묵직하게 느껴진다).
  damping: number;
  // 제약 이완 반복 횟수 — 많을수록 늘어남이 적은(뻣뻣한) 원단, 적을수록
  // 늘어짐/신축성이 있는(부드러운) 원단.
  iterations: number;
}

// "웹 최적화 게임형" 아키텍처로 바꾸면서 감쇠를 전반적으로 낮췄다(=진동을
// 더 빨리 죽인다) — 프록시 캡슐이 실제 몸 굴곡보다 거칠어서 옷감이 표면
// 굴곡을 정밀하게 따라가려 하기보다 "툭 떨어져 차분히 안착"하는 편이
// 시각적으로 더 자연스럽고, 자체충돌을 꺼서 진동을 흡수해줄 감쇠원이
// 하나 줄어든 것도 보완한다.
export const FABRIC_PRESETS: Record<FabricType, FabricPreset> = {
  cotton: { label: "면", gravityScale: 1.0, damping: 0.97, iterations: 18 },
  denim: { label: "데님", gravityScale: 1.35, damping: 0.9, iterations: 24 },
  silk: { label: "실크", gravityScale: 0.7, damping: 0.96, iterations: 12 },
  knit: { label: "니트", gravityScale: 0.9, damping: 0.92, iterations: 8 },
};
