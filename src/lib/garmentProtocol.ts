import type { Vec3Like } from "./clothProtocol";
import type { FabricType } from "./fabricPresets";

// 큰 재설계: 몸판과 소매를 하나의 워커(garmentWorker.ts) 안에서 함께
// 시뮬레이션하고, 그 안에서 진동둘레 다중 스티칭(garmentStitch.ts)으로
// 진짜 서로 당기게 묶는다. 기존 clothProtocol.ts(몸판 전용)와
// sleeveProtocol.ts(소매 전용)를 대체한다 — 두 시뮬레이션이 이제 같은
// 워커 안에 있어서 메시지도 하나로 합친다.
export interface SleeveShapeMsg {
  shoulder: Vec3Like;
  // 33번: shoulder는 SHOULDER_PIN_OUTSET(11.5cm)만큼 밖으로 민 값이라
  // 몸판(평평한 패널)의 어깨 모서리와는 잘 맞지만, 그 값을 그대로 원통
  // 소매의 중심축 시작점으로 쓰면 소매 전체가 실제 팔 중심선보다 계속
  // 바깥쪽에 떠 있게 된다(실측: 마네킹을 숨기면 소매 모양 자체는 멀쩡한데
  // 다시 보이면 대부분 마네킹 팔에 가려 어깨 옆 작은 조각만 남음 — 오클루전
  // 진단으로 확인). trueShoulder는 그 보정 전의 실제 어깨 관절 뼈대 월드
  // 좌표다. 이음매 링(t=0)은 shoulder를 쓰고, 그 아래로는 trueShoulder
  // 쪽으로 중심을 수렴시켜 실제 팔 위에 소매가 올라가게 한다 — 자세한
  // 이유는 buildSleeveSim.ts의 centerAt() 주석 참고.
  trueShoulder: Vec3Like;
  dir: Vec3Like; // 단위 벡터(어깨→팔꿈치 방향)
  length: number;
  radiusSeam: number;
  radiusMax: number;
  radiusHem: number;
}

// "reinitSleeve"는 반팔↔긴팔 전환처럼 소매 관련 값만 바뀌었을 때 쓴다.
// 전엔 소매 종류가 바뀔 때도 "init"(몸판+소매 둘 다 처음부터 다시 빌드)을
// 보냈는데, 실측(전환 직후 화면)해보니 몸판이 이미 잘 늘어져 있던
// 상태에서 갑자기 평평한 미착용 초기 배치로 되돌아가 버리는 버그가
// 있었다 — 몸판 치수(widthM/heightM/pinLeft/pinRight 등)는 소매 종류와
// 무관한데도 "init" 하나로 묶여 있어 매번 같이 재시작됐던 것. 소매만
// 다시 짓는 별도 메시지를 둬서 몸판 시뮬레이션은 계속 진행 중인 상태를
// 유지하게 한다.
export type MainToGarmentWorkerMessage =
  | {
      type: "init";
      widthM: number;
      heightM: number;
      topY: number;
      centerZ: number;
      pinLeft: Vec3Like;
      pinRight: Vec3Like;
      sleeveRows: number;
      sleeveLeft: SleeveShapeMsg;
      sleeveRight: SleeveShapeMsg;
    }
  | {
      type: "reinitSleeve";
      sleeveRows: number;
      sleeveLeft: SleeveShapeMsg;
      sleeveRight: SleeveShapeMsg;
    }
  | {
      type: "rebuildCollision";
      position: Float32Array;
      frontIndex: Uint32Array | null;
      backIndex: Uint32Array | null;
      // 팔 제외 없는 몸 전체 인덱스 — 어깨 곡면에 소매 이음매를 직접
      // 스냅시키는 용도(garmentStitch.ts의 snapToBodySurface,
      // meshCollision.ts의 BakedMesh.wholeBodyIndex 주석 참고).
      wholeBodyIndex: Uint32Array | null;
      capsules: Array<{ top: Vec3Like; bottom: Vec3Like; radius: number }>;
      centerZ: number;
    }
  | {
      type: "step";
      dt: number;
      pinLeft: Vec3Like;
      pinRight: Vec3Like;
      fabric: FabricType;
      sleeveLeft: SleeveShapeMsg;
      sleeveRight: SleeveShapeMsg;
      generation: number;
    };

// generation: 옷 치수/소매 종류가 바뀔 때마다 메인 스레드가 "init"으로
// 새 시뮬레이션을 요청하는데, 그 직전에 큐에 있던 구세대 "step" 응답이
// 늦게 돌아와 신세대 결과를 덮어쓰는 문제를 막는다(clothProtocol.ts의
// 기존 설명과 동일한 이유).
export type GarmentWorkerToMainMessage = {
  type: "positions";
  front: Float32Array;
  back: Float32Array;
  sleeveLeft: Float32Array;
  sleeveRight: Float32Array;
  generation: number;
};
