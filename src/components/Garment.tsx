import { useGLTF, useTexture } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFitStore } from "../store/useFitStore";
import { MannequinCollisionMesh } from "../lib/meshCollision";
import { mannequinRootRef } from "../lib/mannequinRef";
import { buildTorsoProxyCapsules } from "../lib/torsoCapsule";
import { findArmDirection, findHandBone, findShoulderBones } from "../lib/boneUtils";
import { computeShoulderPin } from "../lib/shoulderPin";
import { averageGarmentColor } from "../lib/garmentColor";
import {
  COLS,
  PARTICLES_PER_PANEL,
  REBUILD_DEBOUNCE_MS,
  ROWS,
  SLEEVE_COLS,
  SLEEVE_FLARE_SHORT,
  SLEEVE_LENGTH_LONG_FRACTION,
  SLEEVE_LENGTH_SHORT,
  SLEEVE_RADIUS,
  SLEEVE_RADIUS_SEAM,
  SLEEVE_RADIUS_WRIST,
  SLEEVE_ROWS_LONG,
  SLEEVE_ROWS_SHORT,
} from "../lib/clothConfig";
import type { MainToGarmentWorkerMessage, GarmentWorkerToMainMessage, SleeveShapeMsg } from "../lib/garmentProtocol";
import { MODEL_URL } from "./Mannequin";

interface Props {
  imageUrl: string;
}

const shoulderVec = new THREE.Vector3();
const rightShoulderVec = new THREE.Vector3();
const leftDirVec = new THREE.Vector3();
const rightDirVec = new THREE.Vector3();
const leftHandVec = new THREE.Vector3();
const rightHandVec = new THREE.Vector3();

// 큰 재설계: 몸판(GarmentCloth.tsx)과 소매(SleeveCloth.tsx)를 이 컴포넌트
// 하나로 합쳤다 — 진동둘레 다중 스티칭(garmentStitch.ts)이 두 시뮬레이션을
// 같은 워커(garmentWorker.ts) 안에서 실시간으로 서로 당기게 하려면, 메인
// 스레드 쪽도 하나의 워커/한 벌의 메시지 흐름으로 다뤄야 한다. 이전엔
// GarmentCloth와 SleeveCloth가 완전히 독립된 워커/컴포넌트였다(리스크
// 격리 목적으로 의도적으로 분리) — 이제 스티칭이 두 시뮬레이션을 물리적
// 으로 묶으므로 워커도 하나로 합치는 게 자연스럽다.
function buildTubeGeometry(cols: number, rows: number): { geometry: THREE.BufferGeometry; positions: Float32Array } {
  const geometry = new THREE.BufferGeometry();
  const count = cols * rows;
  const capCenterIndex = count; // 어깨 쪽 뚜껑 중심점(물리 파티클이 아닌 별도 정점)
  const positions = new Float32Array((count + 1) * 3);
  const uvs = new Float32Array((count + 1) * 2);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      uvs[i * 2] = x / cols;
      uvs[i * 2 + 1] = 1 - y / (rows - 1);
    }
  }
  uvs[capCenterIndex * 2] = 0.5;
  uvs[capCenterIndex * 2 + 1] = 1;
  const indices: number[] = [];
  for (let y = 0; y < rows - 1; y++) {
    for (let x = 0; x < cols; x++) {
      const xNext = (x + 1) % cols;
      const a = y * cols + x;
      const b = y * cols + xNext;
      const c = (y + 1) * cols + x;
      const d = (y + 1) * cols + xNext;
      indices.push(a, c, b, b, c, d);
    }
  }
  // 어깨 쪽 뚜껑: 원통에 뚜껑이 없으면 위/옆/뒤 특정 각도에서 카메라가
  // 그 구멍으로 원통 내부를 들여다봐 어깨에 시커먼 구멍이 뚫린 것처럼
  // 보이는 문제가 실측(사용자가 세 각도 스크린샷으로 확인)으로 드러났다
  // — 손목 쪽(밑단)은 실제로 손이 나오는 열린 구멍이라 그대로 둔다.
  for (let x = 0; x < cols; x++) {
    const xNext = (x + 1) % cols;
    indices.push(capCenterIndex, x, xNext);
  }
  // position은 워커 응답이 올 때마다(사실상 매 프레임) 통째로 덮어써진다.
  // THREE.BufferAttribute는 기본값이 StaticDrawUsage(GL_STATIC_DRAW)인데,
  // 실측(Safari/WebKit 독립 실행 스크립트로 재현 — Playwright MCP는
  // Chromium 고정이라 별도 WebKit 바이너리로 확인) 결과 크롬(ANGLE)에서는
  // 매 프레임 갱신해도 문제없이 렌더링됐지만, WebKit(Metal 백엔드)에서는
  // needsUpdate=true를 계속 정상적으로 호출하는데도(버텍스 배열 자체는
  // JS 쪽에서 매 프레임 올바르게 갱신됨, geometry.getAttribute("position")
  // 를 직접 읽어 확인) 실제 화면에 그려지는 내용이 마운트 초반의 낡은
  // 값으로 완전히 멈춰버리는 현상이 재현됐다 — 사용자가 겪은 "소매가
  // 어깨에서 뚝 떨어진 채 허공에 떠 있다"는 증상의 정체였다(물리 데이터는
  // 처음부터 끝까지 정상이었는데 GPU에 그 갱신이 반영되지 않았을 뿐).
  // StaticDrawUsage는 GPU 드라이버에게 "한 번 올리고 다시 안 바꾼다"는
  // 힌트라, 매 프레임 갱신하는 버퍼에는 맞지 않는 힌트였다 — 크롬은
  // 이 힌트를 무시하고도 재업로드를 제대로 처리했지만 WebKit은 그러지
  // 않은 것으로 보인다. DynamicDrawUsage로 명시하면 두 엔진 모두에서
  // 정상 동작한다(재현 스크립트로 확인).
  const positionAttr = new THREE.BufferAttribute(positions, 3);
  positionAttr.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("position", positionAttr);
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  return { geometry, positions };
}

// 물리 워커가 돌려준 0번 행(어깨 이음매) 링의 평균 위치를 뚜껑 중심점
// 자리(positions 배열의 마지막 정점)에 채워 넣는다 — 링이 매 프레임
// 조금씩 움직이므로(팔이 움직이거나 스티칭이 당기면) 뚜껑도 그때그때
// 다시 계산해야 링과 어긋나지 않는다.
function fillCapCenter(positions: Float32Array, cols: number): void {
  let sx = 0;
  let sy = 0;
  let sz = 0;
  for (let x = 0; x < cols; x++) {
    sx += positions[x * 3];
    sy += positions[x * 3 + 1];
    sz += positions[x * 3 + 2];
  }
  const capIndex = positions.length / 3 - 1;
  positions[capIndex * 3] = sx / cols;
  positions[capIndex * 3 + 1] = sy / cols;
  positions[capIndex * 3 + 2] = sz / cols;
}

function toMsg(v: THREE.Vector3): { x: number; y: number; z: number } {
  return { x: v.x, y: v.y, z: v.z };
}

export function Garment({ imageUrl }: Props) {
  const texture = useTexture(imageUrl);
  const { nodes } = useGLTF(MODEL_URL) as unknown as { nodes: Record<string, THREE.Object3D> };
  const shoulderBones = useMemo(() => findShoulderBones(nodes), [nodes]);
  const garmentSize = useFitStore((s) => s.garmentSize);
  const bodySize = useFitStore((s) => s.bodySize);
  const fabric = useFitStore((s) => s.fabric);
  const sleeveType = useFitStore((s) => s.sleeveType);

  // --- 몸판 지오메트리 ---
  const frontPositions = useMemo(() => new Float32Array(PARTICLES_PER_PANEL * 3), []);
  const backPositions = useMemo(() => new Float32Array(PARTICLES_PER_PANEL * 3), []);
  // position에 DynamicDrawUsage를 명시하는 이유는 buildTubeGeometry(소매)
  // 쪽 주석 참고 — 몸판도 워커가 매 프레임 돌려주는 값으로 덮어써지므로
  // 똑같이 WebKit에서 갱신이 GPU에 반영 안 되는 문제를 겪을 수 있다.
  const frontGeometry = useMemo(() => {
    const g = new THREE.PlaneGeometry(1, 1, COLS - 1, ROWS - 1);
    const positionAttr = new THREE.BufferAttribute(frontPositions, 3);
    positionAttr.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute("position", positionAttr);
    return g;
  }, [frontPositions]);
  const backGeometry = useMemo(() => {
    const g = new THREE.PlaneGeometry(1, 1, COLS - 1, ROWS - 1);
    const positionAttr = new THREE.BufferAttribute(backPositions, 3);
    positionAttr.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute("position", positionAttr);
    return g;
  }, [backPositions]);

  const backTexture = useMemo(() => {
    const clone = texture.clone();
    clone.repeat.x = -1;
    clone.offset.x = 1;
    clone.needsUpdate = true;
    return clone;
  }, [texture]);

  const sleeveColor = useMemo(() => {
    const image = texture.image as HTMLImageElement | undefined;
    if (!image) return new THREE.Color(0x808080);
    return averageGarmentColor(image);
  }, [texture]);

  const boxWidthM = garmentSize.width / 100 / 2;
  const boxHeightM = garmentSize.length / 100;
  const image = texture.image as HTMLImageElement | undefined;
  const imageAspect = image && image.width && image.height ? image.width / image.height : 1;
  const boxAspect = boxWidthM / boxHeightM;
  const widthM = imageAspect > boxAspect ? boxWidthM : boxHeightM * imageAspect;
  const heightM = imageAspect > boxAspect ? boxWidthM / imageAspect : boxHeightM;

  // --- 소매 지오메트리 ---
  const sleeveRows = sleeveType === "long" ? SLEEVE_ROWS_LONG : SLEEVE_ROWS_SHORT;
  const { geometry: leftSleeveGeometry, positions: leftSleevePositions } = useMemo(
    () => buildTubeGeometry(SLEEVE_COLS, sleeveRows),
    [sleeveRows],
  );
  const { geometry: rightSleeveGeometry, positions: rightSleevePositions } = useMemo(
    () => buildTubeGeometry(SLEEVE_COLS, sleeveRows),
    [sleeveRows],
  );

  const collisionMesh = useMemo(() => new MannequinCollisionMesh(), []);
  const workerRef = useRef<Worker | null>(null);
  const pendingRef = useRef(false);
  const pendingDtRef = useRef(0);
  const generationRef = useRef(0);

  // 소매 지오메트리/포지션 배열은 sleeveRows(소매 종류)가 바뀔 때마다
  // useMemo가 새 객체를 만든다(행 수가 달라 배열 길이 자체가 바뀌므로
  // 어쩔 수 없다) — 아래 워커 생성 effect가 이 값들에 직접 의존하면,
  // 반팔↔긴팔 전환마다 "몸판과 무관한" 이 변화 때문에 워커 전체가
  // 종료·재생성되어 몸판 시뮬레이션까지 처음부터(평평한 미착용 상태)
  // 다시 시작하는 버그가 실측(반팔→긴팔 전환 직후 화면에서 몸판 그래픽이
  // 사라지고 평평한 사각형만 보임)으로 확인됐다 — ref로 최신 지오메트리를
  // 가리키게 해서, 워커의 onmessage 클로저는 매번 ref.current를 통해
  // "그 시점의 최신" 지오메트리를 쓰되, 워커 자체(및 몸판 시뮬레이션)는
  // 소매 종류가 바뀌어도 계속 살아있게 한다.
  const leftSleeveGeometryRef = useRef(leftSleeveGeometry);
  const rightSleeveGeometryRef = useRef(rightSleeveGeometry);
  const leftSleevePositionsRef = useRef(leftSleevePositions);
  const rightSleevePositionsRef = useRef(rightSleevePositions);
  useEffect(() => {
    leftSleeveGeometryRef.current = leftSleeveGeometry;
    rightSleeveGeometryRef.current = rightSleeveGeometry;
    leftSleevePositionsRef.current = leftSleevePositions;
    rightSleevePositionsRef.current = rightSleevePositions;
  }, [leftSleeveGeometry, rightSleeveGeometry, leftSleevePositions, rightSleevePositions]);

  // 워커는 컴포넌트 생명주기 동안 하나만 띄우고 언마운트 시 종료한다.
  // frontGeometry/backGeometry/frontPositions/backPositions는 몸판
  // 파티클 수(PARTICLES_PER_PANEL)에만 의존해 컴포넌트 생명주기 내내
  // 정체성이 바뀌지 않는다 — 의존성 배열에 남겨둬도 실질적으로 재실행을
  // 유발하지 않는다.
  useEffect(() => {
    const worker = new Worker(new URL("../workers/garmentWorker.ts", import.meta.url), { type: "module" });
    // 이전엔 워커 에러 핸들러가 아예 없었다 — 워커 안에서 예외가 나면 그
    // 프레임의 "step" 응답만 조용히 안 오고(옷감이 그 자리에 얼어붙은
    // 채로 멈춤) 브라우저 콘솔에 아무 흔적도 안 남을 수 있어, 실측으로
    // 원인을 추적하기 어려웠다(사용자가 보고한 "옷이 처져 보인다" 문제를
    // 재현하려다 발견). 최소한 콘솔에 남기기라도 하도록 추가한다.
    worker.onerror = (e) => {
      console.error("Garment worker error:", e.message, `${e.filename}:${e.lineno}`, e.error);
    };
    worker.onmessageerror = (e) => {
      console.error("Garment worker message deserialization error:", e);
    };
    worker.onmessage = (event: MessageEvent<GarmentWorkerToMainMessage>) => {
      const msg = event.data;
      if (msg.type !== "positions") return;
      pendingRef.current = false;
      if (msg.generation !== generationRef.current) return; // 낡은 세대의 응답은 버린다.

      frontPositions.set(msg.front);
      backPositions.set(msg.back);
      (frontGeometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
      (backGeometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
      frontGeometry.computeVertexNormals();
      backGeometry.computeVertexNormals();
      frontGeometry.computeBoundingSphere();
      backGeometry.computeBoundingSphere();

      // 임시 디버그 훅(worker.onerror 근처와 짝) — 워커가 실제로 돌려준
      // 몸판 0번 행(어깨선) 전체와 소매 0번 행 첫 정점을 그대로 노출한다.
      // __fitDebug의 "의도한 핀 값"과 이 값이 다르면 워커 내부(물리
      // 시뮬레이션)에서 문제가 생기는 것이고, 같은데도 화면이 이상하면
      // 렌더링 쪽 문제로 좁혀진다. 어깨 "모서리"뿐 아니라 목선 중앙까지
      // 포함해 0번 행 전체(x=0..COLS-1)의 y좌표를 다 뽑아, 어디서부터
      // 처지기 시작하는지 곡선 전체를 본다.
      const frontRow0Y: number[] = [];
      for (let x = 0; x < COLS; x++) frontRow0Y.push(msg.front[x * 3 + 1]);
      (window as unknown as { __fitDebugActual?: unknown }).__fitDebugActual = {
        frontRow0Y,
        frontRow0First3: Array.from(msg.front.slice(0, 3)),
        backRow0First3: Array.from(msg.back.slice(0, 3)),
        sleeveLeftRow0First3: Array.from(msg.sleeveLeft.slice(0, 3)),
        sleeveRightRow0First3: Array.from(msg.sleeveRight.slice(0, 3)),
      };

      // sleeveRows가 막 바뀐 직후 한두 프레임은 워커가 아직 이전 치수로
      // 보낸 메시지가 도착할 수 있다 — 배열 길이가 안 맞으면 .set()이
      // RangeError를 던지므로, 길이가 일치할 때만 반영하고 다음 프레임을
      // 기다린다(곧 reinitSleeve에 따른 새 치수 메시지가 도착해 자연히
      // 맞아짐). lPos/rPos(지오메트리 쪽 배열)는 buildTubeGeometry가
      // 어깨 쪽 뚜껑 중심점을 위해 격자 정점 수보다 정점 하나(3개 float)
      // 더 갖고 있으므로, msg 쪽 원시 격자 길이와 "+3"만큼 차이 나는 게
      // 정상이다 — 예전엔 완전히 같은 길이를 요구해 이 경우가 절대
      // 참이 될 수 없었고(항상 스킵됨), 그 결과 소매가 물리 시뮬레이션
      // 결과를 전혀 반영하지 못한 채(초기 0으로 채워진 배열 그대로)
      // 렌더되는 회귀가 실측(반팔→긴팔 전환 후 소매가 어깨의 작은
      // 삼각형 조각으로 쪼그라들어 보임)으로 발견됐다.
      const lGeom = leftSleeveGeometryRef.current;
      const rGeom = rightSleeveGeometryRef.current;
      const lPos = leftSleevePositionsRef.current;
      const rPos = rightSleevePositionsRef.current;
      if (msg.sleeveLeft.length === lPos.length - 3 && msg.sleeveRight.length === rPos.length - 3) {
        lPos.set(msg.sleeveLeft);
        rPos.set(msg.sleeveRight);
        fillCapCenter(lPos, SLEEVE_COLS);
        fillCapCenter(rPos, SLEEVE_COLS);
        (lGeom.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
        (rGeom.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
        lGeom.computeVertexNormals();
        rGeom.computeVertexNormals();
        lGeom.computeBoundingSphere();
        rGeom.computeBoundingSphere();
      }
    };
    workerRef.current = worker;
    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, [frontGeometry, backGeometry, frontPositions, backPositions]);

  // 어깨/팔 방향에서 현재 소매 모양을 계산한다. 반팔/긴팔 길이·반지름
  // 산정 로직을 한 곳에 모아 init(빌드)과 step(매 프레임) 양쪽에서 같은
  // 공식을 쓰게 한다.
  function computeSleeveShapes(): { left: SleeveShapeMsg; right: SleeveShapeMsg } | null {
    const { left: leftBone, right: rightBone } = shoulderBones;
    if (!leftBone || !rightBone) return null;

    leftBone.updateWorldMatrix(true, false);
    rightBone.updateWorldMatrix(true, false);
    leftBone.getWorldPosition(shoulderVec);
    rightBone.getWorldPosition(rightShoulderVec);
    const pins = computeShoulderPin(shoulderVec, rightShoulderVec);

    leftDirVec.copy(findArmDirection(leftBone));
    rightDirVec.copy(findArmDirection(rightBone));

    let length: number;
    if (sleeveType === "long") {
      const leftHandBone = findHandBone(leftBone);
      const rightHandBone = findHandBone(rightBone);
      leftHandBone.updateWorldMatrix(true, false);
      rightHandBone.updateWorldMatrix(true, false);
      leftHandBone.getWorldPosition(leftHandVec);
      rightHandBone.getWorldPosition(rightHandVec);
      const leftArmSpan = pins.left.distanceTo(leftHandVec);
      const rightArmSpan = pins.right.distanceTo(rightHandVec);
      length = Math.min(leftArmSpan, rightArmSpan) * SLEEVE_LENGTH_LONG_FRACTION;
    } else {
      length = SLEEVE_LENGTH_SHORT;
    }
    const radiusHem = sleeveType === "long" ? SLEEVE_RADIUS_WRIST : SLEEVE_RADIUS * (1 + SLEEVE_FLARE_SHORT);

    return {
      left: {
        shoulder: toMsg(pins.left),
        dir: toMsg(leftDirVec),
        length,
        radiusSeam: SLEEVE_RADIUS_SEAM,
        radiusMax: SLEEVE_RADIUS,
        radiusHem,
      },
      right: {
        shoulder: toMsg(pins.right),
        dir: toMsg(rightDirVec),
        length,
        radiusSeam: SLEEVE_RADIUS_SEAM,
        radiusMax: SLEEVE_RADIUS,
        radiusHem,
      },
    };
  }

  // 몸 실측이 바뀔 때만(매 프레임이 아니라) 충돌 메시를 다시 굽어 워커로
  // 보낸다 — 굽는 비용이 커서 슬라이더 드래그 중 매 틱마다 하면 버벅인다.
  useEffect(() => {
    const root = mannequinRootRef.current;
    const { left: leftShoulder, right: rightShoulder } = shoulderBones;
    if (!root || !leftShoulder || !rightShoulder) return;
    const timer = setTimeout(() => {
      const { position, frontIndex, backIndex, wholeBodyIndex } = collisionMesh.bake(root);
      const transfer: Transferable[] = [position.buffer];
      if (frontIndex) transfer.push(frontIndex.buffer);
      if (backIndex) transfer.push(backIndex.buffer);
      if (wholeBodyIndex) transfer.push(wholeBodyIndex.buffer);

      leftShoulder.updateWorldMatrix(true, false);
      rightShoulder.updateWorldMatrix(true, false);
      leftShoulder.getWorldPosition(shoulderVec);
      rightShoulder.getWorldPosition(rightShoulderVec);

      // TEMP DIAGNOSTIC: 어깨 관절(핀 기준점) 근처의 실제 마네킹 표면
      // 최고 높이를 재서, 지금 핀 Y가 진짜 "어깨 꼭대기"보다 얼마나
      // 낮은지 확인한다.
      {
        const pinsForDebug = computeShoulderPin(shoulderVec, rightShoulderVec);
        const radius = 0.08;
        let maxYNearLeft = -Infinity;
        let maxYNearRight = -Infinity;
        for (let i = 0; i < position.length; i += 3) {
          const px = position[i];
          const py = position[i + 1];
          const pz = position[i + 2];
          const dxL = px - pinsForDebug.left.x;
          const dzL = pz - pinsForDebug.left.z;
          if (dxL * dxL + dzL * dzL < radius * radius && py > maxYNearLeft) maxYNearLeft = py;
          const dxR = px - pinsForDebug.right.x;
          const dzR = pz - pinsForDebug.right.z;
          if (dxR * dxR + dzR * dzR < radius * radius && py > maxYNearRight) maxYNearRight = py;
        }
        (window as unknown as { __fitDebugShoulderTop?: unknown }).__fitDebugShoulderTop = {
          pinLeftY: pinsForDebug.left.y,
          pinRightY: pinsForDebug.right.y,
          maxSurfaceYNearLeft: maxYNearLeft,
          maxSurfaceYNearRight: maxYNearRight,
          deltaLeft: maxYNearLeft - pinsForDebug.left.y,
          deltaRight: maxYNearRight - pinsForDebug.right.y,
        };
      }

      const { capsules, centerZ } = buildTorsoProxyCapsules(
        { x: shoulderVec.x, y: shoulderVec.y, z: shoulderVec.z },
        { x: rightShoulderVec.x, y: rightShoulderVec.y, z: rightShoulderVec.z },
        bodySize.height / 100,
        bodySize.chest / 100,
      );

      workerRef.current?.postMessage(
        { type: "rebuildCollision", position, frontIndex, backIndex, wholeBodyIndex, capsules, centerZ } satisfies MainToGarmentWorkerMessage,
        transfer,
      );
    }, REBUILD_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [collisionMesh, shoulderBones, bodySize.height, bodySize.chest, bodySize.armLength, bodySize.legLength, bodySize.shoulderWidth]);

  // 몸판 치수(옷 크기 슬라이더, 몸 사이즈)가 바뀌면 워커에 새
  // 시뮬레이션(몸판+소매 둘 다)을 처음부터 구성하도록 요청한다 — 마운트
  // 시 최초 1회 빌드도 여기서 이뤄진다. 소매 종류(반팔/긴팔)는 이
  // 의존성 배열에서 뺐다 — 아래 별도 effect가 "reinitSleeve"로 소매만
  // 다시 짓는다(이유는 garmentProtocol.ts 참고).
  useEffect(() => {
    const { left: leftShoulder, right: rightShoulder } = shoulderBones;
    const worker = workerRef.current;
    const sleeveShapes = computeSleeveShapes();
    if (!leftShoulder || !rightShoulder || !worker || !sleeveShapes) return;

    leftShoulder.updateWorldMatrix(true, false);
    rightShoulder.updateWorldMatrix(true, false);
    leftShoulder.getWorldPosition(shoulderVec);
    rightShoulder.getWorldPosition(rightShoulderVec);
    const pins = computeShoulderPin(shoulderVec, rightShoulderVec);
    const topY = Math.max(pins.left.y, pins.right.y);
    const centerZ = (pins.left.z + pins.right.z) / 2;

    generationRef.current += 1;
    worker.postMessage({
      type: "init",
      widthM,
      heightM,
      topY,
      centerZ,
      pinLeft: { x: pins.left.x, y: pins.left.y, z: pins.left.z },
      pinRight: { x: pins.right.x, y: pins.right.y, z: pins.right.z },
      sleeveRows,
      sleeveLeft: sleeveShapes.left,
      sleeveRight: sleeveShapes.right,
    } satisfies MainToGarmentWorkerMessage);
    pendingDtRef.current = 0;
    pendingRef.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, widthM, heightM, bodySize.armLength, bodySize.shoulderWidth, bodySize.height]);

  // 소매 종류(반팔/긴팔)만 바뀌면 소매만 다시 짓는다 — 몸판(torsoSim)은
  // 건드리지 않아, 이미 늘어져 자리 잡은 몸판이 소매 전환 때마다 평평한
  // 미착용 상태로 되돌아가는 버그(실측으로 확인, 자세한 경위는
  // garmentProtocol.ts 참고)를 막는다. 마운트 시 위 effect가 이미 소매도
  // 함께 지어 보내므로 이 effect가 마운트 때 한 번 더 보내는 건(같은
  // 내용을 다시 지음) 낭비지만 무해하다.
  useEffect(() => {
    const worker = workerRef.current;
    const sleeveShapes = computeSleeveShapes();
    if (!worker || !sleeveShapes) return;
    worker.postMessage({
      type: "reinitSleeve",
      sleeveRows,
      sleeveLeft: sleeveShapes.left,
      sleeveRight: sleeveShapes.right,
    } satisfies MainToGarmentWorkerMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sleeveRows, sleeveType]);

  useFrame((_, delta) => {
    const worker = workerRef.current;
    if (!worker) return;

    const { left: leftShoulder, right: rightShoulder } = shoulderBones;
    if (!leftShoulder || !rightShoulder) return;
    const sleeveShapes = computeSleeveShapes();
    if (!sleeveShapes) return;

    leftShoulder.updateWorldMatrix(true, false);
    rightShoulder.updateWorldMatrix(true, false);
    leftShoulder.getWorldPosition(shoulderVec);
    rightShoulder.getWorldPosition(rightShoulderVec);
    const pins = computeShoulderPin(shoulderVec, rightShoulderVec);

    // 임시 디버그 훅 — Safari에서만 재현되는 어깨 처짐 문제를 사용자
    // 브라우저 콘솔에서 직접 확인하기 위해 추가(원인 확정되면 제거할 것).
    // 콘솔에 `window.__fitDebug`를 입력하면 매 프레임 갱신되는 실제 어깨
    // 본 위치·계산된 핀·소매 모양을 볼 수 있다.
    (window as unknown as { __fitDebug?: unknown }).__fitDebug = {
      leftShoulderBoneRaw: { x: shoulderVec.x, y: shoulderVec.y, z: shoulderVec.z },
      rightShoulderBoneRaw: { x: rightShoulderVec.x, y: rightShoulderVec.y, z: rightShoulderVec.z },
      pinLeft: { x: pins.left.x, y: pins.left.y, z: pins.left.z },
      pinRight: { x: pins.right.x, y: pins.right.y, z: pins.right.z },
      sleeveShapeLeftShoulder: sleeveShapes.left.shoulder,
      sleeveShapeRightShoulder: sleeveShapes.right.shoulder,
      leftShoulderBoneName: leftShoulder.name,
      rightShoulderBoneName: rightShoulder.name,
      collisionMeshReady: collisionMesh.ready,
    };

    pendingDtRef.current += delta;
    // 워커가 아직 이전 step을 처리 중이면 이번 프레임은 건너뛴다(렌더는
    // 계속 진행되고, 옷감은 워커가 따라잡는 대로 갱신된다).
    if (pendingRef.current) return;
    pendingRef.current = true;
    const dt = pendingDtRef.current;
    pendingDtRef.current = 0;

    worker.postMessage({
      type: "step",
      dt,
      pinLeft: { x: pins.left.x, y: pins.left.y, z: pins.left.z },
      pinRight: { x: pins.right.x, y: pins.right.y, z: pins.right.z },
      fabric,
      sleeveLeft: sleeveShapes.left,
      sleeveRight: sleeveShapes.right,
      generation: generationRef.current,
    } satisfies MainToGarmentWorkerMessage);
  });

  // 임시 디버그 훅 — 어깨 근처에 나타나는 회색/무늬 없는 삼각형 조각이
  // 텍스처 로딩 실패인지 지오메트리 문제인지 확인하는 용도.
  (window as unknown as { __fitDebugTex?: unknown }).__fitDebugTex = {
    textureImageComplete: (texture.image as HTMLImageElement | undefined)?.complete,
    textureImageSize: texture.image
      ? [(texture.image as HTMLImageElement).width, (texture.image as HTMLImageElement).height]
      : null,
    backTextureImageComplete: (backTexture.image as HTMLImageElement | undefined)?.complete,
    sleeveColorHex: sleeveColor.getHexString(),
    frontPositionsSample: Array.from(frontPositions.slice(0, 9)),
    backPositionsSample: Array.from(backPositions.slice(0, 9)),
  };

  return (
    <group>
      <mesh geometry={frontGeometry} frustumCulled={false}>
        <meshStandardMaterial map={texture} side={THREE.DoubleSide} roughness={0.85} />
      </mesh>
      <mesh geometry={backGeometry} frustumCulled={false}>
        <meshStandardMaterial map={backTexture} side={THREE.DoubleSide} roughness={0.85} />
      </mesh>
      <mesh geometry={leftSleeveGeometry} frustumCulled={false}>
        <meshStandardMaterial color={sleeveColor} side={THREE.DoubleSide} roughness={0.85} />
      </mesh>
      <mesh geometry={rightSleeveGeometry} frustumCulled={false}>
        <meshStandardMaterial color={sleeveColor} side={THREE.DoubleSide} roughness={0.85} />
      </mesh>
    </group>
  );
}

useGLTF.preload(MODEL_URL);
