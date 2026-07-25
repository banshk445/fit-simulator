import type { Vec3Like } from "./clothProtocol";
import type { FabricType } from "./fabricPresets";

// 46번(전면 재설계 — 통합 단일 패널): 소매가 더 이상 별도 패널이 아니라
// 몸판(앞/뒤) 자체의 넓은 바깥쪽 열이 팔 방향으로 뻗은 부분이므로, 예전
// SleeveShapeMsg의 반지름 필드들(radiusSeam/radiusMax/radiusHem)은 더
// 이상 필요 없다 — 남는 건 "이 팔이 어느 방향으로 얼마나 뻗어 있는지"
// (몸판 레이아웃이 그 열들을 얼마나 멀리 늘어뜨릴지 계산하는 데 씀)와
// "이 팔이 충돌해야 할 캡슐이 어디 있는지"(trueShoulder+dir+length로
// garmentWorker.ts가 직접 계산)뿐이다.
export interface ArmShapeMsg {
  dir: Vec3Like; // 단위 벡터(어깨→팔꿈치 방향)
  trueShoulder: Vec3Like; // 실제 어깨 관절 뼈대 월드 좌표(팔 충돌 캡슐 축)
  length: number;
}

export type MainToGarmentWorkerMessage =
  | {
      type: "init";
      widthM: number;
      heightM: number;
      topY: number;
      centerZ: number;
      sleeveWidthM: number;
      pinLeft: Vec3Like;
      pinRight: Vec3Like;
      // 46번: 0번 행(어깨선) 중 몸통에 고정되는 안쪽 구간의 각 열마다
      // 실측(레이캐스팅)으로 구한 추가 리프트 — computeNecklineLift
      // (Garment.tsx) 참고. 균일 상수 하나로는 어깨 캡(삼각근) 돔의
      // 정점이 중심에 가까울수록 더 높이 솟는 걸 못 따라가서 열마다
      // 실제로 재서 보정한다.
      necklineLift: number[];
      armLeft: ArmShapeMsg;
      armRight: ArmShapeMsg;
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
      necklineLift: number[];
      fabric: FabricType;
      armLeft: ArmShapeMsg;
      armRight: ArmShapeMsg;
      generation: number;
    };

// generation: 옷 치수가 바뀔 때마다 메인 스레드가 "init"으로 새
// 시뮬레이션을 요청하는데, 그 직전에 큐에 있던 구세대 "step" 응답이
// 늦게 돌아와 신세대 결과를 덮어쓰는 문제를 막는다(clothProtocol.ts의
// 기존 설명과 동일한 이유).
export type GarmentWorkerToMainMessage =
  | {
      type: "positions";
      front: Float32Array;
      back: Float32Array;
      // 핏 맵(물리와 무관): 정점별 몸 표면까지의 부호 있는 거리(cm, 몸
      // 안쪽이면 음수) — wholeBodyCollisionMesh에 대한 순수 조회 결과일
      // 뿐, 물리 해석에는 전혀 쓰이지 않는다. garmentWorker.ts의 "step"
      // 케이스, ArrayBvhCollision.signedClearance 참고.
      frontFit: Float32Array;
      backFit: Float32Array;
      generation: number;
    }
  | {
      // 범위 B(소매 재설계) 구현 1번(격자 생성) 검증 전용 — sim 생성 직후,
      // buildConstraints()/step() 이전의 순수 초기 배치를 그대로 echo한다
      // (물리 한 스텝만 지나도 중력/자체충돌로 mm 단위 흔들림이 섞여
      // "시접 거리 0" 같은 순수 배치 검증이 흐려지므로). "init" 처리마다
      // 딱 한 번만 보낸다 — 매 프레임 도는 "step"과 무관.
      type: "gridDebug";
      front: Float32Array;
      back: Float32Array;
      sleeveLeft: Float32Array;
      sleeveRight: Float32Array;
      panelParticleStart: number[]; // [front, back, sleeveLeft, sleeveRight]
      panelParticleCount: number[];
    };
