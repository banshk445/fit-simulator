import { useEffect, useMemo, useRef } from "react";
import { useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

// 임시 진단(가슴 스케일 시 몸 메시 폭발 원인 가르기): ?nocounter=1
const NO_COUNTER = import.meta.env.DEV && new URLSearchParams(window.location.search).get("nocounter") === "1";
import { DEFAULT_BODY_SIZE, useFitStore } from "../store/useFitStore";
import { mannequinBonesRef, mannequinPoseRef, mannequinRootRef, poseStopped } from "../lib/mannequinRef";
import { findElbowBone, findHandBone, findShoulderBones } from "../lib/boneUtils";
import { isBone, isDescendantOfAny, pointBoneTowardWorldDirection, worldDirection } from "../lib/boneUtils";

// public/models/mannequin.glb — Adobe Fuse/Mixamo 기반의 맨몸 남성 캐릭터
// ("Ch36")를 T포즈로 내려받아 Blender로 glTF 변환한 파일. 단일 메시라
// Remy처럼 옷 아래에 몸통이 안 뚫려 있는(구멍 없는) 게 확인돼 골랐다 —
// 자세한 경위는 public/models/CREDITS.md 참고.
//
// 절대 경로("/models/...")로 하드코딩했더니 Electron 데스크톱 앱(프로덕션
// 빌드를 file:// 프로토콜로 직접 여는 방식)에서 이 경로가 사이트 루트가
// 아니라 파일시스템 루트를 가리켜버려 모델을 못 찾고(Failed to fetch)
// 마네킹은 물론 옷까지 아무것도 안 그려져 화면이 완전히 검게 보이는
// 문제가 실측(패키징된 앱을 터미널에서 직접 실행해 렌더러 콘솔 로그
// 확인)으로 드러났다 — `import.meta.env.BASE_URL`을 쓰면 vite.config.ts의
// `base` 설정(웹 배포용 "/"든 Electron용 "./"든)에 맞춰 항상 올바르게
// 해석된다.
export const MODEL_URL = `${import.meta.env.BASE_URL}models/mannequin.glb`;

// 헬멧 바이저처럼 중립적인 마네킹 형태에 맞지 않는 메시나, "joints"처럼 실제
// 몸 표면과 거의 같은 범위를 겹쳐 덮고 있는 보조 메시는 렌더링에서 숨긴다
// (두 표면이 겹쳐 보이면 Z-파이팅처럼 지저분하게 깜빡인다). 충돌 메시를
// 굽는 StaticGeometryGenerator도 visible=false인 메시는 통째로 건너뛰므로,
// 몸통 자체를 구성하는 메시(예: 옷으로만 덮이고 그 아래 스킨이 없는 형태의
// 캐릭터의 "몸 위에 입혀진 옷" 메시)는 여기 넣지 않도록 주의할 것 — 숨기면
// 그 부분이 충돌 표면 자체가 없는 구멍이 되어 옷이 몸을 그냥 뚫고 지나가
// 버린다(실측으로 확인한 실제 사례가 있다).
const HIDDEN_MESH_KEYWORDS = ["visor", "joints"];

type BoneCategory = "arm" | "leg" | "shoulder" | "torso";
type Axis = "x" | "y" | "z";

interface ScalableBone {
  bone: THREE.Object3D;
  axis: Axis;
}

// 36번(큰 재설계): 가슴둘레(bodySize.chest) 슬라이더가 지금껏 collisionMesh
// 재빌드 effect의 의존성 배열에는 이미 들어있었지만(마치 작동하는 것처럼
// 보였다), 정작 마네킹 메시 자체는 전혀 스케일되지 않았다 — arm/leg/
// shoulder만 뼈대 카테고리로 분류돼 있었고 몸통(spine)은 아예 대상이
// 아니었다. 즉 가슴둘레를 아무리 바꿔도 마네킹은 항상 같은 두께였고,
// 그 위에 걸리는 옷만 슬라이더에 반응해 "몸은 그대론데 옷만 이상하게
// 커지거나 작아지는" 상황이었다 — "신체 사이즈도 조절하며 핏을
// 확인한다"는 목적을 몸 쪽에서 이미 못 지키고 있었다.
interface GirthBone {
  bone: THREE.Object3D;
  axes: Axis[]; // 길이 축이 아닌 나머지 두 축(둘레 방향)
}

// 모델마다 뼈대 이름이 달라도 대응할 수 있도록 이름 기반으로 느슨하게 분류한다.
// ForeArm/UpLeg은 각각 Arm/Leg의 부분 문자열을 포함하므로, 같은 카테고리로
// 합쳐서(팔 = Arm+ForeArm, 다리 = UpLeg+Leg) 인식한다.
//
// 주의: "Armature"(arm 포함), "Legacy"(leg 포함) 같은 비-뼈대 컨테이너 이름도
// 부분 문자열 매칭에 걸릴 수 있다. 그래서 이름 매칭 대상은 실제 THREE.Bone
// 인스턴스로만 제한한다(isBone, isDescendantOfAny는 boneUtils.ts 공용 함수 —
// GarmentCloth.tsx도 어깨 핀 뼈대를 찾을 때 같은 판별 로직을 쓴다).
function classifyBone(name: string): BoneCategory | null {
  const n = name.toLowerCase();
  if (n.includes("shoulder")) return "shoulder";
  if (n.includes("arm")) return "arm";
  if (n.includes("leg")) return "leg";
  if (n.includes("spine")) return "torso";
  return null;
}

const ALL_AXES: Axis[] = ["x", "y", "z"];

// P23 §1 — 팔 관절 멈춤 판정용 스크래치(양팔 × 어깨·팔꿈치·손 × xyz = 18값).
const armProbe = new THREE.Vector3();
const armPrev = new Float64Array(18);
// P23 §1 — 스케일 값의 직전 프레임 사본(개수는 본 구성에 따라 정해진다).
const scalePrev: number[] = [];

// "길이 방향" 축은 모델마다 다를 수 있다 (Soldier.glb는 로컬 Y가 길이 방향이지만
// Xbot.glb는 로컬 X였다 — Y로 하드코딩했다가 팔이 길어지는 대신 두꺼워지는
// 버그가 났었다). 그래서 자식 뼈대의 로컬 위치에서 절대값이 가장 큰 성분의
// 축을 그 뼈대의 "길이 방향"으로 동적으로 판별한다.
function lengthAxis(bone: THREE.Object3D): Axis {
  const child = bone.children.find((c) => isBone(c));
  if (!child) return "y";
  const { x, y, z } = child.position;
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  const az = Math.abs(z);
  if (ax >= ay && ax >= az) return "x";
  if (ay >= ax && ay >= az) return "y";
  return "z";
}

function firstBoneChild(bone: THREE.Object3D): THREE.Object3D | undefined {
  return bone.children.find((c) => isBone(c));
}

export function Mannequin() {
  const bodySize = useFitStore((s) => s.bodySize);
  const { scene, nodes } = useGLTF(MODEL_URL) as unknown as {
    scene: THREE.Object3D;
    nodes: Record<string, THREE.Object3D>;
  };
  const outerRef = useRef<THREE.Group>(null);

  // GarmentCloth가 충돌 메시를 구울 때 참조할 수 있도록, 실제 렌더 루트를
  // 공유 모듈에 등록한다.
  useEffect(() => {
    mannequinRootRef.current = outerRef.current;
    // P5 §1 — v2 몸 스냅샷이 쓸 어깨 본. `Garment.tsx`와 **같은 함수**로 찾는다.
    mannequinBonesRef.current = findShoulderBones(nodes);
    return () => {
      mannequinRootRef.current = null;
      mannequinBonesRef.current = { left: null, right: null };
    };
  }, [nodes]);

  // 마네킹처럼 보이도록 원본 텍스처/머티리얼을 무광 회색으로 통일하고,
  // 헬멧 바이저 등 마네킹에 어울리지 않는 파츠는 숨긴다.
  useEffect(() => {
    scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        const name = obj.name.toLowerCase();
        if (HIDDEN_MESH_KEYWORDS.some((kw) => name.includes(kw))) {
          obj.visible = false;
          return;
        }
        obj.material = new THREE.MeshStandardMaterial({ color: 0xcbd5e1, roughness: 0.7 });
      }
    });
  }, [scene]);

  // 카테고리별 뼈대를 찾고, 같은 카테고리 안에서 조상-자손 관계인 뼈대는
  // 자손을 제외해 최상단 뼈대 하나에만 스케일을 적용한다 (Arm 하나만 늘려도
  // 하위의 ForeArm/Hand는 계층 구조를 통해 함께 늘어나므로 중복 적용 불필요).
  // 각 최상단 뼈대에는 자식 위치로부터 판별한 길이축도 함께 저장한다.
  const boneGroups = useMemo(() => {
    const grouped: Record<BoneCategory, THREE.Object3D[]> = { arm: [], leg: [], shoulder: [], torso: [] };
    for (const [name, node] of Object.entries(nodes)) {
      if (!isBone(node)) continue;
      const category = classifyBone(name);
      if (category) grouped[category].push(node);
    }

    const rootsOnly = {} as Record<BoneCategory, ScalableBone[]>;
    for (const category of Object.keys(grouped) as BoneCategory[]) {
      const set = new Set(grouped[category]);
      rootsOnly[category] = grouped[category]
        .filter((node) => !isDescendantOfAny(node, set))
        .map((bone) => ({ bone, axis: lengthAxis(bone) }));
    }
    return rootsOnly;
  }, [nodes]);

  // torso(spine)는 길이 방향(위아래로 키를 늘림)이 아니라 둘레 방향(가슴
  // 두께)을 스케일해야 하므로, 위 boneGroups.torso(길이축 하나만 저장)와는
  // 별도로 "길이축이 아닌 나머지 두 축"을 계산해 둔다 — Spine 하나만
  // 최상단으로 남기는 조상-자손 필터링은 boneGroups와 동일한 결과를 그대로
  // 재사용한다(어차피 rootsOnly.torso가 이미 최상단 Spine 하나만 갖고 있음).
  const torsoGirthBones: GirthBone[] = useMemo(() => {
    return boneGroups.torso.map(({ bone, axis }) => ({
      bone,
      axes: ALL_AXES.filter((a) => a !== axis),
    }));
  }, [boneGroups.torso]);

  // Three.js는 부모 뼈대의 스케일을 자손이 그대로 물려받는다 — Spine을
  // 둘레 방향으로 스케일하면 그 아래 매달린 어깨/팔/목/머리까지 같이
  // 굵어지거나 가늘어져 버린다(극단값 조합 스트레스 테스트로 실측: 가슴둘레
  // 140cm에서 팔·손·머리까지 부풀어 마네킹 자세 자체가 일그러져 보임 —
  // 어깨/팔은 "부풀어야 할 이유가 없는" 부위인데 부모 스케일이 새어 들어간
  // 것). 팔 쪽은 boneGroups.shoulder(팔이 매달리는 분기점)에, 목/머리
  // 쪽은 별도로 찾은 neck 뼈대에 역스케일(1/chestMultiplier)을 걸어
  // 상쇄한다 — 어깨/팔/머리 자체의 길이 스케일과는 다른 축(girth 축)이라
  // 서로 간섭하지 않는다.
  // 상쇄 대상 축은 어깨 자신의 길이축이 아니라 spine이 "실제로 스케일한"
  // 축이어야 한다(대부분 같은 축이지만, 다른 모델에서 우연히 다를 경우를
  // 대비해 spine 기준 축을 그대로 재사용한다).
  const shoulderGirthAxes: GirthBone[] = useMemo(() => {
    const torsoAxes = torsoGirthBones[0]?.axes ?? [];
    return boneGroups.shoulder.map(({ bone }) => ({ bone, axes: torsoAxes }));
  }, [boneGroups.shoulder, torsoGirthBones]);

  const neckCounterScaleBones: GirthBone[] = useMemo(() => {
    const necks: THREE.Object3D[] = [];
    for (const [name, node] of Object.entries(nodes)) {
      if (isBone(node) && name.toLowerCase().includes("neck")) necks.push(node);
    }
    const set = new Set(necks);
    // 목/머리 쪽에 상쇄해야 할 축은 spine이 "실제로 스케일한" 둘레 축
    // 뿐이다(spine의 길이 축은 애초에 안 건드렸으니 거기까지 상쇄하면
    // 오히려 목이 위아래로 눌리는 새 왜곡이 생긴다).
    const torsoAxes = torsoGirthBones[0]?.axes ?? [];
    return necks.filter((node) => !isDescendantOfAny(node, set)).map((bone) => ({ bone, axes: torsoAxes }));
  }, [nodes, torsoGirthBones]);

  // T-pose(바인드 포즈)는 팔이 수평으로 뻗어 있어 부자연스럽다. 팔 뼈대가
  // 현재 향하고 있는 방향을 측정해서, 완전히 수직(월드 -Y)이 아니라 몸
  // 중심선에서 살짝 바깥쪽으로 벌어진 방향("릴랙스드 A-포즈")을 향하도록
  // 회전시킨다. 팔을 곧게 내리면 손(특히 손가락)이 배/골반에 딱 붙게
  // 되는데, 옷자락이 그 높이까지 늘어질 때 손가락처럼 얇고 복잡한 형체와
  // 충돌 계산을 해야 해서 그 부분이 찢어진 것처럼 불안정해지는 문제가
  // 실측으로 확인됐다 — 실제 옷 피팅 3D 도구에서도 흔히 A-포즈를 쓰는
  // 이유와 같다. 어깨 뼈의 월드 X 좌표 부호로 좌/우를 판별해 바깥쪽
  // 방향을 정하므로, 모델이 바뀌어도(뼈대 이름과 무관하게) 안전하다.
  //
  // 46번(동적 포징 — 겨드랑이 드레이프 실측): 원래 1회성 useEffect였던
  // 것을 매 프레임 각도가 서서히 오가는 애니메이션으로 바꿔, 소매
  // 방향(computeArmShapes, Garment.tsx)이 매 프레임 읽는 이 뼈대의 실제
  // 월드 방향이 계속 움직이게 해서 자체충돌/힌지/언더암 당김/드레이프가
  // 실시간으로 반응하는지 관찰했었다.
  //
  // 소매 범위 B 조사(겨드랑이 캡슐 침투 진동 원인 추적)에서 이 8초 주기
  // 흔들림이 그 진동의 실제 원인으로 확인됐다 — 정적 기하 보정으로는
  // 못 따라잡는 진폭(팔 캡슐 clearance가 초당 수 mm씩 계속 움직임)이라,
  // 기본값은 다시 46번 이전의 1회성 릴랙스드 A포즈(0.6, 벌어짐 — 아래
  // ENABLE_ARM_SWAY_DEBUG 참고)로 고정한다. 동적 포징 관찰이 다시
  // 필요해지면(예: 다른 겨드랑이 드레이프 조사) 플래그만 켜면 된다.
  const ENABLE_ARM_SWAY_DEBUG = false;
  const ARM_SWAY_FIXED_OUTWARD = 0.6;
  const armPoseElapsed = useRef(0);
  // P23 §1 — 팔 관절 6점(양팔 × 어깨·팔꿈치·손)의 직전 프레임 월드 좌표.
  const armSeeded = useRef(false);
  const scaleSeeded = useRef(false);
  // P24 §2 — A포즈 되먹임 고정 상태. 스케일이 다시 움직이면 풀린다(위 주석).
  const armPoseLocked = useRef(false);
  useFrame((_, delta) => {
    // P5 §1 — 이 루프가 A포즈를 적용한다(카운터는 아래 스케일 루프가 올린다 — 그쪽이
    // 같은 프레임에서 «뒤»에 돌기 때문이다. 두 루프가 다 돈 뒤라야 몸이 확정된다).
    //
    // ── P24 §2 — **되먹임을 1회성으로 만든다.**
    // 이 루프는 `worldDirection`으로 **자기가 직전 프레임에 쓴 `bone.quaternion`이 섞인
    // 월드 행렬**을 다시 읽어(`boneUtils.ts:189-195`) 델타를 만들고(`:208`)
    // `premultiply(...).normalize()`로 **누적 곱**을 한다(`:227`). 읽는 값이 쓴 값에
    // 의존하는 닫힌 고리라 **고정점이 없다** — 스케일 lerp는 증분이 언더플로하면 정확히
    // 멎지만(`lerp(a,t,α) === a`) 쿼터니언 누적곱+정규화는 마지막 비트가 계속 흔들린다.
    // P23 §1-2 ③이 그것을 값으로 잡았다(17초 관측 · 하한 1 ULP · `armStillFrames` 0).
    //
    // **해제 조건은 「스케일이 다시 움직였는가」 하나다** — 조건을 손으로 열거하지 않는다.
    // 몸 슬라이더 5축(키·팔·다리·어깨너비·가슴둘레)은 **전부** 아래 스케일 루프의 lerp를
    // 거치므로 어느 하나가 움직이면 `scaleStillFrames`가 0으로 떨어진다. 목록을 적으면
    // 축이 늘 때 빠뜨린다(P20·P21이 그 실패였다) — 신호 하나에 매단다.
    // (A포즈 루프가 스케일 루프보다 «먼저» 도므로 해제는 1프레임 늦다 — 무해.)
    if (mannequinPoseRef.scaleStillFrames === 0) {
      if (armPoseLocked.current) console.log("[dress·P24] A포즈 고정 해제 — 스케일이 다시 움직였다");
      armPoseLocked.current = false;
    }
    if (armPoseLocked.current) return;

    let outwardAmount = ARM_SWAY_FIXED_OUTWARD;
    if (ENABLE_ARM_SWAY_DEBUG) {
      armPoseElapsed.current += delta;
      const cyclePhase = (armPoseElapsed.current / 8) * Math.PI * 2; // 8초 주기
      outwardAmount = 0.425 + 0.175 * Math.sin(cyclePhase); // 0.25~0.6 사이 오간다
    }

    const shoulderPos = new THREE.Vector3();
    for (const { bone } of boneGroups.arm) {
      const child = firstBoneChild(bone);
      if (!child) continue;
      const currentDir = worldDirection(bone, child);
      bone.getWorldPosition(shoulderPos);
      const sign = Math.sign(shoulderPos.x) || 1;
      const outwardDown = new THREE.Vector3(sign * outwardAmount, -1, 0).normalize();
      pointBoneTowardWorldDirection(bone, currentDir, outwardDown);
    }

    // P24 §2 — 멎었으면 **여기서 고정**한다. 판정은 P23의 `poseStopped` 그대로 —
    // 새 상수 0 · 새 문턱 0(`POSE_SETTLE_EPS` 재사용). 흔들림 관측용 디버그 스윙이
    // 켜져 있으면 고정하지 않는다(그때는 계속 움직이는 것이 의도다).
    if (!ENABLE_ARM_SWAY_DEBUG && poseStopped()) {
      armPoseLocked.current = true;
      console.log(
        `[dress·P24] A포즈 고정 — frames ${mannequinPoseRef.frames}` +
        ` · 스케일 정지 ${mannequinPoseRef.scaleStillFrames}프레임` +
        ` · 팔 이동 ${mannequinPoseRef.maxArmDeltaM.toExponential(2)}m`,
      );
    }
  });

  // 소스 파일마다 단위가 다를 수 있다(m, cm, inch...) — 원본 바운딩 박스
  // 높이를 재서 기준 신장(DEFAULT_BODY_SIZE.height)에 맞도록 스케일을 자동
  // 보정한다. 이미 미터 단위인 파일(Xbot)은 비율이 1에 가까워 실질적인
  // 영향이 없고, cm 단위 파일은 자동으로 1/100로 줄어든다 — 모델을 바꿀
  // 때마다 단위를 직접 확인/하드코딩할 필요가 없다.
  const { groundOffsetY, unitScale } = useMemo(() => {
    const box = new THREE.Box3().setFromObject(scene);
    const rawHeight = box.max.y - box.min.y;
    const targetHeight = DEFAULT_BODY_SIZE.height / 100;
    const scale = rawHeight > 0.001 ? targetHeight / rawHeight : 1;
    return { groundOffsetY: -box.min.y * scale, unitScale: scale };
  }, [scene]);

  // 위에서 계산한 단위 보정 스케일을 실제로 적용한다. groundOffsetY(발이
  // 바닥에 닿는 오프셋)도 마운트 시 1회만 측정해 고정값으로 쓴다 — 동적
  // 다리 길이 변화까지 실시간으로 접지 보정하지는 않는다.
  useEffect(() => {
    scene.scale.setScalar(unitScale);
  }, [scene, unitScale]);

  useFrame((_, delta) => {
    const outer = outerRef.current;
    if (!outer) return;
    const t = 1 - Math.pow(0.001, delta);

    const heightMultiplier = bodySize.height / DEFAULT_BODY_SIZE.height;
    const armMultiplier = bodySize.armLength / DEFAULT_BODY_SIZE.armLength;
    const legMultiplier = bodySize.legLength / DEFAULT_BODY_SIZE.legLength;
    const shoulderMultiplier = bodySize.shoulderWidth / DEFAULT_BODY_SIZE.shoulderWidth;
    // 둘레(circumference) = 2π×반지름이라, 둘레 비율 = 반지름(둘레축 스케일) 비율과
    // 같다 — 가슴둘레 슬라이더 비율을 girth 축 스케일에 그대로 곱해도 된다.
    const chestMultiplier = bodySize.chest / DEFAULT_BODY_SIZE.chest;

    const s = THREE.MathUtils.lerp(outer.scale.x, heightMultiplier, t);
    outer.scale.setScalar(s);

    for (const { bone, axis } of boneGroups.arm) {
      bone.scale[axis] = THREE.MathUtils.lerp(bone.scale[axis], armMultiplier, t);
    }
    for (const { bone, axis } of boneGroups.leg) {
      bone.scale[axis] = THREE.MathUtils.lerp(bone.scale[axis], legMultiplier, t);
    }
    for (const { bone, axis } of boneGroups.shoulder) {
      bone.scale[axis] = THREE.MathUtils.lerp(bone.scale[axis], shoulderMultiplier, t);
    }
    for (const { bone, axes } of torsoGirthBones) {
      for (const axis of axes) {
        bone.scale[axis] = THREE.MathUtils.lerp(bone.scale[axis], chestMultiplier, t);
      }
    }
    // 위 torsoGirthBones 스케일이 어깨/팔/목/머리 쪽으로 새어 들어가는 걸
    // 상쇄한다 — 자세한 이유는 shoulderGirthAxes/neckCounterScaleBones
    // 선언부 주석 참고.
    const counterChestMultiplier = NO_COUNTER ? 1 : 1 / chestMultiplier;
    for (const { bone, axes } of shoulderGirthAxes) {
      for (const axis of axes) {
        bone.scale[axis] = THREE.MathUtils.lerp(bone.scale[axis], counterChestMultiplier, t);
      }
    }
    for (const { bone, axes } of neckCounterScaleBones) {
      for (const axis of axes) {
        bone.scale[axis] = THREE.MathUtils.lerp(bone.scale[axis], counterChestMultiplier, t);
      }
    }

    // ── P5b §1 — **정착 잔차**. 몸 스냅샷은 프레임 수가 아니라 이 값으로 판정한다
    // (lerp 수렴 프레임 수는 프레임률·이동량에 따라 달라진다 — mannequinRef 주석).
    // 위에서 lerp를 «적용한 뒤»의 목표 대비 최대 편차를 그대로 잰다.
    // P23 §1 — 같은 순회에서 **프레임 간 변화량**도 잰다. 잔차(목표 대비 편차)와 다른 양이다:
    // lerp는 고정점에 닿으면 `lerp(a,t,α) === a`가 되어 **값이 멎지만** 잔차는 0이 아닌 채로
    // 남는다(실측 1.33e-15에서 평탄). 「굽어도 되는 시점」은 잔차가 아니라 **멎었는가**다.
    let residual = Math.abs(outer.scale.x - heightMultiplier);
    let step = 0;
    let k = 0;
    const acc = (v: number, target: number): void => {
      const d = Math.abs(v - target); if (d > residual) residual = d;
      if (k < scalePrev.length) { const c = Math.abs(v - scalePrev[k]); if (c > step) step = c; }
      scalePrev[k] = v; k += 1;
    };
    acc(outer.scale.x, heightMultiplier);
    for (const { bone, axis } of boneGroups.arm) acc(bone.scale[axis], armMultiplier);
    for (const { bone, axis } of boneGroups.leg) acc(bone.scale[axis], legMultiplier);
    for (const { bone, axis } of boneGroups.shoulder) acc(bone.scale[axis], shoulderMultiplier);
    for (const { bone, axes } of torsoGirthBones) for (const axis of axes) acc(bone.scale[axis], chestMultiplier);
    for (const { bone, axes } of shoulderGirthAxes) for (const axis of axes) acc(bone.scale[axis], counterChestMultiplier);
    for (const { bone, axes } of neckCounterScaleBones) for (const axis of axes) acc(bone.scale[axis], counterChestMultiplier);
    if (k > scalePrev.length) { scalePrev.length = k; scaleSeeded.current = false; }
    mannequinPoseRef.scaleStillFrames = scaleSeeded.current && step === 0 ? mannequinPoseRef.scaleStillFrames + 1 : 0;
    scaleSeeded.current = true;
    mannequinPoseRef.maxScaleResidual = residual;
    mannequinPoseRef.frames += 1;

    // ── P23 §1 — **팔 포즈가 실제로 멈췄는지** 잰다. 위 잔차는 스케일 lerp의 목표 대비
    // 편차이고, 몸 스냅샷이 읽는 것은 **어깨·팔꿈치·손의 월드 좌표**다(`bodySnapshot`).
    // 두 루프(A포즈 → 스케일)가 다 돈 «뒤»가 그 프레임의 확정 상태라 여기서 잰다.
    // 새 상수 0 — 문턱을 쓰지 않고 **프레임 간 이동량이 정확히 0인가**만 본다.
    const { left: armL, right: armR } = mannequinBonesRef.current;
    if (armL && armR) {
      let k = 0;
      let moved = 0;
      for (const root of [armL, armR]) {
        for (const bone of [root, findElbowBone(root), findHandBone(root)]) {
          bone.updateWorldMatrix(true, false);
          bone.getWorldPosition(armProbe);
          for (const v of [armProbe.x, armProbe.y, armProbe.z]) {
            const d = Math.abs(v - armPrev[k]);
            if (d > moved) moved = d;
            armPrev[k] = v;
            k += 1;
          }
        }
      }
      mannequinPoseRef.armSample = Array.from(armPrev);
      if (armSeeded.current) {
        mannequinPoseRef.maxArmDeltaM = moved;
        mannequinPoseRef.armStillFrames = moved === 0 ? mannequinPoseRef.armStillFrames + 1 : 0;
      } else {
        armSeeded.current = true;
      }
    }
  });

  return (
    <group ref={outerRef}>
      <group position={[0, groundOffsetY, 0]}>
        <primitive object={scene} />
      </group>
    </group>
  );
}

useGLTF.preload(MODEL_URL);
