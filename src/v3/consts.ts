/* v3-35 — v3 상수의 «단일 정의». 값은 전부 앞 회차 등재분 그대로다.
 * Node 하네스 · Node 드라이버 · 브라우저 워커가 같은 수를 쓰게 한다(#65 계열). */
export const G = 9.81;
export const DT = 1 / 60;
/** 옷 두께 [m] — S3·S3b·v3-13 */
export const THICK = 1e-3;
/** 옷–옷 분리 거리 = 2×두께 */
export const SEP = 2 * THICK;
/** 마찰계수 — v3-16(출처 미확보 #23 이월) */
export const MU = 0.3;
/** 속도 감쇠 [1/s] — v3-16 */
export const DAMP = 6;
/** S3b ② 허용오차 — 한 서브스텝 재수렴 폭(v3-12) */
export const TOL_SELF = 1e-4;
/** SDF 메모리 예산 — v3-13 */
export const SDF_BUDGET = 64 * 1024 * 1024;
export type Fabric = { k: number; rho: number; B: number };
/** v3-26 §1 등재분 — 이름과 값이 한 곳에만 있게 한다(#57 계열) */
export const FABRICS: Record<string, Fabric> = {
  gray: { k: 69, rho: 0.187, B: 2.3191698e-5 },
  denim: { k: 2027.8, rho: 0.324, B: 6.42e-5 },
  sweat: { k: 25, rho: 0.224, B: 5.947e-5 },
  swim: { k: 209.2, rho: 0.204, B: 6.024e-5 },
};
