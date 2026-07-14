import type { FabricType } from "./fabricPresets";

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

// 메인 스레드(GarmentCloth) → 물리 워커(clothWorker)
export type MainToWorkerMessage =
  | {
      type: "initCloth";
      widthM: number;
      heightM: number;
      topY: number;
      centerZ: number;
      pinLeft: Vec3Like;
      pinRight: Vec3Like;
    }
  | {
      type: "rebuildCollision";
      position: Float32Array;
      frontIndex: Uint32Array | null;
      backIndex: Uint32Array | null;
      // 캡슐은 이제 주 충돌이 아니라 보조 안전망이다 — BVH 메시 충돌이
      // 탐지 반경 밖으로 놓친 파티클(몸속에 갇힘)을 구조하는 역할만 한다.
      // 자세한 이유는 torsoCapsule.ts, clothWorker.ts 참고.
      capsules: Array<{ top: Vec3Like; bottom: Vec3Like; radius: number }>;
      centerZ: number;
    }
  | { type: "step"; dt: number; pinLeft: Vec3Like; pinRight: Vec3Like; fabric: FabricType; generation: number };

// 물리 워커 → 메인 스레드
//
// generation: "step" 요청에 실려온 값을 그대로 되돌려준다. 옷 크기(품/총장
// 등)가 바뀌면 메인 스레드가 매번 새 시뮬레이션을 만들라고 워커에 요청하는데
// (initCloth), 그 순간 이미 이전(구) 시뮬레이션에 대한 "step" 요청이 워커
// 큐에 먼저 들어가 있을 수 있다 — 워커는 요청을 순서대로 처리하므로 그
// 구세대 step의 결과("positions" 응답)가 신세대 시뮬레이션이 만들어진
// *이후에* 메인 스레드로 돌아올 수 있다. 이 응답을 그대로 적용해버리면
// 방금 새로 만든 시뮬레이션의 결과를 구세대의(치수가 다른) 결과로 덮어써
// 버려, 옷감 격자가 순간적으로 뒤틀린 상태로 굳어버리는 문제가 실측으로
// 확인됐다(품/총장 등 어떤 치수를 바꾸든 재현). 메인 스레드는 현재
// 세대 번호와 다른 응답을 무시해 이 낡은 응답이 화면에 반영되지 않게 한다.
export type WorkerToMainMessage = { type: "positions"; front: Float32Array; back: Float32Array; generation: number };
