import * as THREE from "three";
import { MeshBVH } from "three-mesh-bvh";
import type { CollisionResolver } from "./clothPhysics";

const scratchPoint = new THREE.Vector3();
const scratchA = new THREE.Vector3();
const scratchB = new THREE.Vector3();
const scratchC = new THREE.Vector3();
const scratchNormal = new THREE.Vector3();

// 겹침을 한 번에 완전히 풀면(계수 1.0) 넓은 탐지 반경 안에서 한꺼번에 걸린
// 파티클들이 전부 동시에 margin 거리로 스냅되면서, 구조 제약이 미처
// 저항하기도 전에 옷 전체가 몸통 표면으로 순식간에 수축(shrink-wrap)해
// 버리는 문제가 실측으로 확인됐다(탐지 반경을 15cm로 넓히자 옷이 목 주변의
// 작은 조각으로 쪼그라듦). selfCollision.ts와 같은 under-relaxation 패턴을
// 적용해, 한 호출당 목표 지점까지 일부만 이동시키고 나머지는 이후 반복에서
// 구조 제약과 번갈아 가며 서서히 수렴하게 한다.
const PUSH_RELAXATION = 0.4;

// meshCollision.ts의 MannequinCollisionMesh가 메인 스레드(살아있는 Object3D
// 씬 그래프)에서 구운 위치/인덱스 원시 배열을 넘겨받아, BVH 구축과 충돌
// 쿼리를 수행한다. Object3D가 필요 없어 Worker 안에서도 그대로 쓸 수 있다.
export class ArrayBvhCollision {
  private geometry: THREE.BufferGeometry | null = null;
  private bvh: MeshBVH | null = null;
  private hitInfo = { point: new THREE.Vector3(), distance: 0, faceIndex: -1 };

  get ready(): boolean {
    return this.bvh !== null;
  }

  rebuild(position: Float32Array, index: Uint32Array | null): void {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(position, 3));
    if (index) geometry.setIndex(new THREE.BufferAttribute(index, 1));
    this.geometry = geometry;
    this.bvh = new MeshBVH(geometry, { maxLeafSize: 10 });
  }

  private faceNormal(faceIndex: number, target: THREE.Vector3): THREE.Vector3 {
    const geometry = this.geometry!;
    const index = geometry.index;
    const posAttr = geometry.getAttribute("position");
    let ia: number;
    let ib: number;
    let ic: number;
    if (index) {
      ia = index.getX(faceIndex * 3);
      ib = index.getX(faceIndex * 3 + 1);
      ic = index.getX(faceIndex * 3 + 2);
    } else {
      ia = faceIndex * 3;
      ib = faceIndex * 3 + 1;
      ic = faceIndex * 3 + 2;
    }
    scratchA.fromBufferAttribute(posAttr, ia);
    scratchB.fromBufferAttribute(posAttr, ib);
    scratchC.fromBufferAttribute(posAttr, ic);
    scratchB.sub(scratchA);
    scratchC.sub(scratchA);
    return target.crossVectors(scratchB, scratchC).normalize();
  }

  // 점 p에서 margin만큼 띄운 표면 위치를 한 번에(부분 이완 없이) 구한다.
  // createResolver()의 리졸버는 PUSH_RELAXATION(0.4)만큼만 한 호출에
  // 이동시켜 여러 프레임에 걸쳐 서서히 수렴하는 걸 전제로 하는데, 이 함수는
  // 매 프레임 처음부터 다시 계산되는 값(예: 소매 이음매 링의 목표 위치)에
  // 쓰기 위한 것이라 그 전제가 안 맞는다 — 매번 40%만 이동하면 영원히 목표에
  // 못 닿는다. detectionRadius 안에서 표면을 못 찾으면 null.
  closestSurfacePoint(px: number, py: number, pz: number, margin: number, detectionRadius: number): THREE.Vector3 | null {
    const bvh = this.bvh;
    if (!bvh) return null;
    scratchPoint.set(px, py, pz);
    const hit = bvh.closestPointToPoint(scratchPoint, this.hitInfo, 0, detectionRadius);
    if (!hit) return null;
    this.faceNormal(hit.faceIndex, scratchNormal);
    return new THREE.Vector3(
      hit.point.x + scratchNormal.x * margin,
      hit.point.y + scratchNormal.y * margin,
      hit.point.z + scratchNormal.z * margin,
    );
  }

  // margin만큼 표면 밖으로 밀어내는 CollisionResolver를 만든다. 삼각형의
  // 실제 면 법선을 써서, 파티클이 표면 안쪽으로 뚫고 들어간 경우에도(가장
  // 가까운 점에서 파티클 쪽 방향이 아니라) 항상 바깥 방향으로 밀려나게 한다.
  //
  // detectionRadius(BVH maxThreshold)와 실제 밀어내는 거리(margin)를 분리한
  // 이유: 예전엔 이 둘이 같은 값이었는데, closestPointToPoint는 maxThreshold
  // 보다 먼 표면점은 아예 "찾지 못한 것"으로 취급해 hit이 null이 된다. 몸통
  // 두께가 10cm 이상인데 margin을 1~2cm로 좁혀두면, 제약/중력이 파티클을
  // 한 서브스텝 만에 그보다 더 깊이 밀어넣었을 때 다음 충돌 검사가 표면을
  // 아예 못 찾아 그 파티클을 몸통 속에 영영 방치해버린다 — 매 프레임 같은
  // 모양으로 안 움직이는(수치 진동이 아니라 안정된) 구멍이 바로 이 증상과
  // 일치했다(실측: 인접 정점 간 거리는 전부 정상 범위인데 특정 파티클
  // 군집이 표면 밖으로 다시 못 나옴). 탐지 반경은 넉넉하게 잡아 "몸통 속에
  // 갇힌" 파티클도 구조해내고, 실제로 밀어내는 거리는 원단 두께 근사치인
  // 좁은 margin 그대로 유지한다.
  //
  // 32번: 이 리졸버는 "뚫고 들어갔을 때만 밀어내기"가 아니라 탐지 반경
  // 안의 모든 점을 항상 margin 거리로 끌어당긴다(위 주석에도 이미
  // "탐지 반경을 15cm로 넓히자 옷이 목 주변의 작은 조각으로 쪼그라듦"이라는
  // 같은 증상이 기록돼 있었다) — 어깨 캡(목~겨드랑이) 구간은 원래
  // 마네킹 표면과 가까운 거리(0~9cm)에 있어 이 탐지 반경 안에 항상
  // 들어오는데, 이 구간은 pullShoulderCapToSurface가 "핀 쪽으로 넓게
  // 유지"와 "표면에 밀착"을 행 위치에 따라 직접 보간해서 관리하도록
  // 32번에서 새로 설계했다 — 그런데 이 일반 메시 충돌 리졸버가 서브스텝
  // 내부에서 훨씬 자주(반복마다) 돌면서 매번 표면 margin 거리로 다시
  // 끌어당겨버려, pullShoulderCapToSurface의 "넓게 유지" 목표를 매번
  // 무효화시키고 있었다(실측: 초기 배치·런타임 보정 목표를 둘 다
  // 바꿔봐도 결과가 거의 그대로였던 이유). skipLocalStart/End로 이
  // 리졸버가 건드리지 않을 로컬 인덱스 구간(패널 하나 안에서, 어깨 캡
  // 행들)을 지정할 수 있게 한다 — 기본값(둘 다 undefined)은 예전과
  // 동일하게 전체 범위에 적용된다.
  createResolver(
    margin: number,
    detectionRadius = margin,
    skipLocalStart?: number,
    skipLocalEndExclusive?: number,
  ): CollisionResolver {
    return (positions, pinned, n) => {
      const bvh = this.bvh;
      if (!bvh) return;
      for (let i = 0; i < n; i++) {
        if (pinned[i]) continue;
        if (skipLocalStart !== undefined && skipLocalEndExclusive !== undefined && i >= skipLocalStart && i < skipLocalEndExclusive) {
          continue;
        }
        const ix = i * 3;
        scratchPoint.set(positions[ix], positions[ix + 1], positions[ix + 2]);
        const hit = bvh.closestPointToPoint(scratchPoint, this.hitInfo, 0, detectionRadius);
        if (!hit) continue;
        this.faceNormal(hit.faceIndex, scratchNormal);
        const targetX = hit.point.x + scratchNormal.x * margin;
        const targetY = hit.point.y + scratchNormal.y * margin;
        const targetZ = hit.point.z + scratchNormal.z * margin;
        positions[ix] += (targetX - positions[ix]) * PUSH_RELAXATION;
        positions[ix + 1] += (targetY - positions[ix + 1]) * PUSH_RELAXATION;
        positions[ix + 2] += (targetZ - positions[ix + 2]) * PUSH_RELAXATION;
      }
    };
  }
}
