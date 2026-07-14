import * as THREE from "three";
import { StaticGeometryGenerator } from "three-mesh-bvh";
import { findArmSegments, findHeadPosition } from "./boneUtils";

export interface BakedMesh {
  position: Float32Array;
  frontIndex: Uint32Array | null;
  backIndex: Uint32Array | null;
  // 팔(어깨~손) 영역을 제외하지 않은 몸 전체 인덱스 — 실측(탑다운 각도)으로
  // 확인된, 어깨-소매 이음매 근처에 마네킹 피부가 비쳐 보이는 틈을 메우는
  // 용도(garmentStitch.ts의 snapToBodySurface 참고). frontIndex/backIndex는
  // 몸판(앞판/뒤판) 옷감이 팔 표면과 깜빡이며 겹치는 걸 막으려고 어깨~손
  // 반경 9cm 안쪽 삼각형을 일부러 뺐는데(excludeArms), 정작 소매 이음매가
  // 채워야 할 실제 3D 어깨 곡면은 바로 그 제외된 영역 안에 있다 — 그래서
  // 이 용도로는 제외 없는 원본 인덱스가 필요하다.
  wholeBodyIndex: Uint32Array | null;
}

const ARM_EXCLUDE_RADIUS = 0.09;
// 머리 뼈대 위치를 중심으로 한 구 반경 — 이 반경 안의 삼각형은
// wholeBodyIndex(어깨-소매 이음매 스냅 전용 원본 인덱스)에서 제외한다.
// 디버그 색상(빨/파/초)으로 소매 지오메트리만 표시해 실측한 결과, 이
// 인덱스에 머리 삼각형이 그대로 남아 있으면 목선 근처 이음매 링 점의
// "가장 가까운 표면"이 머리 쪽으로 잡혀 소매 이음매 전체가 머리 위로
// 빨려 들어가 목 위에 공 모양으로 뭉치고(정작 실제 어깨는 맨살로
// 남는) 버그가 나는 게 확인됐다. Mixamo Head 뼈대는 보통 턱 근처(머리
// 바닥 부근)에 위치해 반경을 머리 절반 정도로 넉넉히 잡아야 정수리까지
// 덮이면서도, 목~어깨 쪽은 잘라내지 않을 만큼 작아야 한다.
const HEAD_EXCLUDE_RADIUS = 0.11;
const scratchAB = new THREE.Vector3();
const scratchAP = new THREE.Vector3();
const scratchClosest = new THREE.Vector3();

// 점 p에서 선분 ab까지의 최단 거리(제곱)를 구한다 — 팔 캡슐 배제에 쓴다.
function pointToSegmentDistSq(px: number, py: number, pz: number, a: THREE.Vector3, b: THREE.Vector3): number {
  scratchAB.subVectors(b, a);
  scratchAP.set(px - a.x, py - a.y, pz - a.z);
  const abLenSq = scratchAB.lengthSq();
  const t = abLenSq > 1e-9 ? THREE.MathUtils.clamp(scratchAP.dot(scratchAB) / abLenSq, 0, 1) : 0;
  scratchClosest.copy(a).addScaledVector(scratchAB, t);
  return (px - scratchClosest.x) ** 2 + (py - scratchClosest.y) ** 2 + (pz - scratchClosest.z) ** 2;
}

// 옷에 소매가 없어 팔과는 충돌할 필요가 없는데, 몸통 표면과 팔 표면이
// 옷자락 높이에서 가까이 겹쳐 있으면 "가장 가까운 표면"이 프레임마다
// 오락가락해 찢어진 것처럼 보이는 아티팩트가 생긴다(실측으로 확인). 각
// 팔을 어깨~손 선분으로 근사한 캡슐 반경 안에 있는 삼각형은 통째로
// 걸러낸다. (스킨 가중치로 팔 정점을 잘라낸 대체 메시를 만들어 굽는
// 방식도 시도했지만, 클론한 지오메트리로 새 SkinnedMesh를 bind()하는
// 과정에서 스키닝 계산이 깨져 몸통이 원점 근처로 찌그러지는 버그가 있었다
// — 이 방식은 이미 올바르게 구워진 결과에서 위치만으로 걸러내므로 그런
// 위험이 없다.)
function excludeArms(
  position: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  index: THREE.BufferAttribute | THREE.InterleavedBufferAttribute | null,
  armSegments: Array<{ start: THREE.Vector3; end: THREE.Vector3 }>,
): Uint32Array | null {
  if (!index) return null;
  if (armSegments.length === 0) return Uint32Array.from(index.array);

  const radiusSq = ARM_EXCLUDE_RADIUS * ARM_EXCLUDE_RADIUS;
  const kept: number[] = [];
  for (let t = 0; t < index.count; t += 3) {
    const a = index.getX(t);
    const b = index.getX(t + 1);
    const c = index.getX(t + 2);
    const cx = (position.getX(a) + position.getX(b) + position.getX(c)) / 3;
    const cy = (position.getY(a) + position.getY(b) + position.getY(c)) / 3;
    const cz = (position.getZ(a) + position.getZ(b) + position.getZ(c)) / 3;
    const nearArm = armSegments.some((seg) => pointToSegmentDistSq(cx, cy, cz, seg.start, seg.end) < radiusSq);
    if (nearArm) continue;
    kept.push(a, b, c);
  }
  return Uint32Array.from(kept);
}

// 머리 뼈대를 중심으로 한 구 안의 삼각형을 걸러낸다(excludeArms와 같은
// 방식). headCenter가 없으면(머리 뼈대를 못 찾으면) 원본을 그대로
// 돌려준다 — 모델에 머리 뼈대가 없는 극단적인 경우에도 안전하게
// 동작해야 한다.
function excludeHead(
  position: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  index: THREE.BufferAttribute | THREE.InterleavedBufferAttribute | null,
  headCenter: THREE.Vector3 | null,
): Uint32Array | null {
  if (!index) return null;
  if (!headCenter) return Uint32Array.from(index.array);

  const radiusSq = HEAD_EXCLUDE_RADIUS * HEAD_EXCLUDE_RADIUS;
  const kept: number[] = [];
  for (let t = 0; t < index.count; t += 3) {
    const a = index.getX(t);
    const b = index.getX(t + 1);
    const c = index.getX(t + 2);
    const cx = (position.getX(a) + position.getX(b) + position.getX(c)) / 3;
    const cy = (position.getY(a) + position.getY(b) + position.getY(c)) / 3;
    const cz = (position.getZ(a) + position.getZ(b) + position.getZ(c)) / 3;
    const distSq = (cx - headCenter.x) ** 2 + (cy - headCenter.y) ** 2 + (cz - headCenter.z) ** 2;
    if (distSq < radiusSq) continue;
    kept.push(a, b, c);
  }
  return Uint32Array.from(kept);
}

// 옷 앞판/뒤판이 각자 몸통의 맞는 쪽(앞/뒤)하고만 충돌하도록, 구운 삼각형을
// Z 좌표 기준으로 앞면/뒷면 두 그룹으로 나눈다. 이걸 안 나누고 몸통 전체를
// 하나의 BVH로 두면 "가장 가까운 표면"만 보고 밀어내다가, 뒤판 파티클이
// 실수로 몸통 앞면 쪽으로 쏠리는 일이 생긴다 — 앞판/뒤판이 서로 다른 쪽에서
// 늘어져야 하는데 둘 다 같은 면에 들러붙어 옷이 아니라 판때기 하나처럼
// 보이는 원인이었다(실측으로 확인: 같은 행에서 앞/뒤판 좌표가 거의 동일).
// 몸통의 실제 앞/뒤 두께 중앙(바운딩 박스 Z 중점)을 기준으로 나누면 어떤
// 모델이든(정확한 Z=0 정렬 여부와 무관하게) 합리적으로 절반씩 갈린다.
function splitFrontBack(
  position: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  index: Uint32Array | null,
): { frontIndex: Uint32Array | null; backIndex: Uint32Array | null } {
  if (!index) return { frontIndex: null, backIndex: null };

  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < position.count; i++) {
    const z = position.getZ(i);
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  const splitZ = (minZ + maxZ) / 2;

  const front: number[] = [];
  const back: number[] = [];
  for (let t = 0; t < index.length; t += 3) {
    const a = index[t];
    const b = index[t + 1];
    const c = index[t + 2];
    const centroidZ = (position.getZ(a) + position.getZ(b) + position.getZ(c)) / 3;
    const bucket = centroidZ >= splitZ ? front : back;
    bucket.push(a, b, c);
  }
  return { frontIndex: Uint32Array.from(front), backIndex: Uint32Array.from(back) };
}

// Xbot 마네킹(스키닝 메시)의 "현재 포즈" 표면을 정적 지오메트리로 구워서
// 위치/인덱스 원시 배열을 뽑아낸다. StaticGeometryGenerator가 스킨/본 변형을
// 반영해 굽기 때문에 몸 실측(키/팔다리 길이 등)이 바뀐 자세에도 정확히
// 대응된다. 살아있는 Object3D 씬 그래프가 필요한 유일한 단계라 메인
// 스레드에서만 가능하다 — 실제 BVH 구축과 충돌 쿼리는 이 배열을 넘겨받은
// 물리 워커(clothWorker.ts, bvhFromArrays.ts 참고)가 맡는다. 굽기 자체는
// 비용이 있어 매 프레임이 아니라 몸 실측이 바뀔 때만 다시 호출해야 한다.
export class MannequinCollisionMesh {
  private generator: StaticGeometryGenerator | null = null;
  private geometry: THREE.BufferGeometry | null = null;

  get ready(): boolean {
    return this.geometry !== null;
  }

  bake(root: THREE.Object3D): BakedMesh {
    if (!this.generator) {
      this.generator = new StaticGeometryGenerator(root);
      this.generator.applyWorldTransforms = true;
    }
    this.geometry = this.generator.generate(this.geometry ?? undefined);
    const positionAttr = this.geometry.getAttribute("position");
    const position = Float32Array.from(positionAttr.array);

    const armSegments = findArmSegments(root);
    const torsoOnlyIndex = excludeArms(positionAttr, this.geometry.index, armSegments);
    const { frontIndex, backIndex } = splitFrontBack(positionAttr, torsoOnlyIndex);
    const headCenter = findHeadPosition(root);
    const wholeBodyIndex = excludeHead(positionAttr, this.geometry.index, headCenter);
    return { position, frontIndex, backIndex, wholeBodyIndex };
  }
}
