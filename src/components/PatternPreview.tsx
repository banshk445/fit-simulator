// v2 Stage 2a — 정적 배치 + 패널별 UV 화면 확인 전용(DEV · `?patterncore=1`).
//
// **물리 없음.** 2a는 드레이프를 돌리지 않으므로(§6: 물리 무변경) 이 컴포넌트는
// `buildPatternGarment`의 정적 배치 좌표를 그대로 BufferGeometry로 올린다.
// 워커·시뮬 배선은 2b에서 온다.
//
// 왜 fixture를 입력으로 쓰나: 하네스(`npm run check:pattern`)가 재는 것과
// **정확히 같은 몸**을 그려야 숫자와 그림이 같은 대상을 가리킨다. 마네킹
// 팔 흔들림은 기본 off(Mannequin.tsx `ENABLE_ARM_SWAY_DEBUG = false`,
// 고정 A포즈)라 fixture 포즈와 화면 마네킹이 어긋나지 않는다.
//
// 텍스처는 **체커**다. 사진 텍스처로는 UV 왜곡·뒤집힘이 안 보인다 —
// 체커는 정사각형이 어디서 늘어나고 어디서 뒤집히는지 그대로 드러낸다.
// 패널별 UV는 공통 축척이므로 네 패널의 칸 크기가 같아야 정상이다.
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useFitStore } from "../store/useFitStore";
import { buildSeamBridge, updateSeamBridge, type SeamStrip } from "./seamBridge";
import { DRESS_RESULT_EVENT } from "./DressButton";
import { ArrayBvhCollision } from "../lib/bvhFromArrays";
import { makeOutlineProvider } from "../lib/bodyOutline";
import { PATTERN_EDGE_INTERIOR_M } from "../lib/patternGarment";

const CHECKER_TEXELS = 32;

function makeCheckerTexture(): THREE.DataTexture {
  const n = CHECKER_TEXELS;
  const data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const on = ((x >> 1) + (y >> 1)) % 2 === 0;
      const i = (y * n + x) * 4;
      data[i] = on ? 220 : 90;
      data[i + 1] = on ? 225 : 110;
      data[i + 2] = on ? 235 : 150;
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

let __r74 = 0;
export function PatternPreview(): React.JSX.Element | null {
  const garmentSize = useFitStore((s) => s.garmentSize);
  // P5 — 몸 슬라이더가 패턴에 도달한다. 이 의존성이 재제도를 건다.
  const bodySize = useFitStore((s) => s.bodySize);
  const sleeveType = useFitStore((s) => s.sleeveType);
  const fabric = useFitStore((s) => s.fabric);
  // `?patternstate=1` — 2b 하네스가 남긴 최종 상태(시뮬 결과)를 그린다.
  // 없으면 2a 정적 배치를 그린다. 물리는 여전히 여기서 돌지 않는다.
  const useDressState = new URLSearchParams(window.location.search).get("patternstate") === "1";
  // ── 48회차 `?cleanrender=1` — **캡처 전용 토글 · 기본 off · 물리 무관.**
  // 47회차 δ가 옆선 세로 결함에 렌더 성분 3종이 항상 얹힌다는 것을 코드에서 확인했다:
  //  ① 패널마다 따로 `computeVertexNormals()` → 패널 경계에서 법선 불연속
  //  ② 시접 브리지가 단색 띠로 항상 그려짐 — **75회차부터 원단 대표색**이고
  //     업로드가 없을 때만 회청 `#6b7f8c`로 폴백한다(그 전에는 항상 회청이었다)
  //  ③ 패널을 따로 그려 시접 rest 6mm가 세로 틈으로 보임(주석이 이미 등재)
  // 이 토글은 ①의 법선을 시접 쌍끼리 **평균해 용접**하고 ②를 **숨긴다**.
  // **정점 위치는 한 좌표도 건드리지 않는다** — 표현만 바꿔 렌더 몫을 분리한다.
  const cleanRender = new URLSearchParams(window.location.search).get("cleanrender") === "1";
  const [geos, setGeos] = useState<THREE.BufferGeometry[] | null>(null);
  // P2c(f) — 워커 착장 결과를 받아 그리기 위한 최소 상태. 정적 배치 렌더는 그대로 두고
  // **정점 좌표만 덮어쓴다**(지오메트리 재생성 0 · UV·인덱스·브리지 위상 불변).
  const liveRef = useRef<{ bridge: ReturnType<typeof buildSeamBridge>; starts: number[]; counts: number[]; total: number } | null>(null);
  const [bridgeGeo, setBridgeGeo] = useState<THREE.BufferGeometry | null>(null);
  const checkerTexture = useMemo(() => makeCheckerTexture(), []);
  // ── 68회차 — **업로드 이미지 배선**. 직전 확인: v2 경로에 소비가 **애초에 없었다**
  // (체커가 무조건 붙고 store를 안 봤다). 캠페인 내내 캡처가 체커였던 이유다.
  // 표시 파라미터는 **v1 `Garment.tsx`를 그대로 따른다** — v1은 drei `useTexture`를
  // 쓰는데 그 구현이 `useLoader(TextureLoader, url)` + `gl.initTexture`뿐이라
  // **colorSpace·flipY·wrap을 하나도 설정하지 않는다**(three 기본값). 그래서 여기서도
  // `TextureLoader` 기본값을 그대로 둔다 — 임의 값 도입 0.
  // `garmentImage`는 `blob:`(업로드) 또는 `data:`(?autofit=1) **문자열**이다.
  // 없거나 로드 실패면 **체커로 폴백**한다(기존 캡처 재현성 보존).
  // 물리·지오메트리·UV·`patternstate` 경로는 한 줄도 건드리지 않는다.
  const garmentImage = useFitStore((s) => s.garmentImage);
  // ── 74회차 판별 로그 L1/L2/L3 (진단 전용 · console.log만 · 거동 0 · 새 상수 0) ──
  __r74 += 1;
  console.log(`[74판별·L1 렌더] #${__r74} garmentImage=${garmentImage === null ? "null" : typeof garmentImage + ":" + String(garmentImage).slice(0, 40)}`);
  const [uploadedTexture, setUploadedTexture] = useState<THREE.Texture | null>(null);
  useEffect(() => {
    console.log(`[74판별·L2 uploadedTexture effect 진입] garmentImage=${garmentImage === null ? "null" : String(garmentImage).slice(0, 40)}`);
    if (!garmentImage) { setUploadedTexture(null); return; }
    let alive = true;
    let made: THREE.Texture | null = null;
    new THREE.TextureLoader().load(
      garmentImage,
      (tex) => {
        if (!alive) { tex.dispose(); return; } // 교체가 앞질렀다 — 즉시 해제(누수 방지)
        made = tex;
        setUploadedTexture(tex);
      },
      undefined,
      () => { if (alive) setUploadedTexture(null); }, // 실패 → 체커 폴백
    );
    return () => { alive = false; if (made) made.dispose(); };
  }, [garmentImage]);
  // ObjectURL 자체는 해제하지 않는다 — store가 소유하고 v1도 같은 문자열을 쓴다
  // (`revokeObjectURL`은 저장소 어디에도 없다). 여기서 해제하면 v1이 깨진다.
  const texture = uploadedTexture ?? checkerTexture;

  // ── 71회차 **A(프린트 합성) + B(패널별 map 분리)** ────────────────────────────
  // 68회차 배선은 업로드 이미지 **한 장을 4패널에 그대로** 붙였다. 그래서 앞/뒤/소매가
  // 같은 그림을 반복했다(69 §5 ②). 여기서 v1 `compositeGarmentTexture`를 재사용해
  // **앞판 = 원단 대표색 + 가슴 프린트 / 뒤판·소매 = 대표색 단색**으로 가른다.
  // 상수는 v1에서 **그대로 상속**하고(신규 0) v2 적응(프린트 폭·중심)은 `uMax`에서 도출한다.
  // `averageGarmentColor`는 쓰지 않는다 — v1이 실패로 등재한 경로다(70 §5-1).
  // 합성 실패·업로드 없음이면 **체커 폴백**. 물리·지오메트리·UV는 안 건드린다.
  const [composited, setComposited] = useState<{ tex: THREE.Texture; solid: string } | null>(null);
  useEffect(() => {
    console.log(`[74판별·L3 composited effect 진입] garmentImage=${garmentImage === null ? "null" : String(garmentImage).slice(0, 40)}`);
    if (!garmentImage) { setComposited(null); return; }
    let alive = true;
    let made: THREE.Texture | null = null;
    void (async () => {
      try {
        console.log("[74판별·L3a import 직전]");
        const { compositeGarmentTexture } = await import("../lib/garmentTextureComposite");
        console.log("[74판별·L3b import 직후]");
        const img = new Image();
        img.src = garmentImage;
        // 73회차 정정 — **`decode()`를 기다리면 안 된다.** 탭이 백그라운드면 Chrome이
        // decode를 정지시켜 프로미스가 **영영 settle되지 않고**(실측: 8초 타임아웃 ·
        // 그때 `naturalWidth`는 이미 723) 합성이 통째로 막혀 조용히 체커로 떨어진다.
        // 71회차 촬영이 통과한 것은 탭이 계속 앞에 있었기 때문이다.
        // v1은 이 경우를 이미 처리한다 — `Garment.tsx:336` `.catch(() => {})`로
        // **디코드를 기다리지 않고 진행**한다. 여기서도 v1과 같은 성격으로 맞춘다:
        // 진행 조건은 **로드 완료**(`complete && naturalWidth > 0`)이고 decode는 시도만 한다.
        // **새 상수 0**(타임아웃 값을 두지 않는다 — 로드 이벤트가 조건이다).
        await new Promise<void>((res) => {
          if (img.complete && img.naturalWidth > 0) { res(); return; }
          img.onload = () => res();
          img.onerror = () => res();
        });
        console.log(`[74판별·L3c 로드 대기 직후] naturalWidth=${img.naturalWidth}`);
        void img.decode().catch(() => {}); // 기다리지 않는다(v1과 같다)
        if (!img.naturalWidth) throw new Error("이미지 로드 실패");
        if (!alive) return;
        // 몸판이 쓰는 u 대역 = 앞판 uv의 최댓값. **실제 속성에서 직접 뜬다**
        // (`patternGarment.ts:236-256`이 만든 값 그대로 · 새 상수·별도 술어 0 — 함정 12).
        // 지오메트리가 아직 없으면 1(= v1과 계산 동치)로 둔다.
        const uvAttr = geos && geos[0] ? geos[0].getAttribute("uv") : null;
        let uMax = 1;
        if (uvAttr) {
          let m = 0;
          for (let k = 0; k < uvAttr.count; k++) { const u = uvAttr.getX(k); if (u > m) m = u; }
          if (m > 0) uMax = m;
        }
        console.log(`[74판별·L3d composite 호출 직전] uMax=${uMax}`);
        const canvas = compositeGarmentTexture(img, {
          uMax,
          onDiag: (d) => {
            console.log(
              `[71계기·합성 판별자] 대표색 rgb(${d.color.r}, ${d.color.g}, ${d.color.b})` +
              ` · 캔버스(0,0) ${d.corner00 ? `rgb(${d.corner00.r}, ${d.corner00.g}, ${d.corner00.b})` : "읽기 실패"}` +
              ` · 프린트 bbox ${d.printBox ? `${d.printBox.w.toFixed(0)}×${d.printBox.h.toFixed(0)}px @(${d.printBox.x.toFixed(0)},${d.printBox.y.toFixed(0)})` : "없음"}` +
              ` · 프레임 비율 ${(d.frameFracW * 100).toFixed(1)}% × ${(d.frameFracH * 100).toFixed(1)}%` +
              ` · PRINT_MAX_FRAME_FRACTION ${d.maxFrameFired ? "**발동**(프린트 버림)" : "미발동"}` +
              ` · **재스캔(G2′)** ${d.rescan ? `성분 ${d.rescan.components}개 중 경계접촉 ${d.rescan.excluded}개 제외 → ${d.rescan.box ? `bbox ${d.rescan.box.w.toFixed(0)}×${d.rescan.box.h.toFixed(0)}px @(${d.rescan.box.x.toFixed(0)},${d.rescan.box.y.toFixed(0)})` : "남은 성분 없음"}` : "미실행(1패스 통과)"}` +
              ` · uMax ${uMax.toFixed(4)}`,
            );
          },
        });
        console.log(`[74판별·L3e composite 반환] ${canvas.width}x${canvas.height}`);
        if (!alive) return;
        const tex = new THREE.CanvasTexture(canvas);
        made = tex;
        const ctx = canvas.getContext("2d");
        const px = ctx ? ctx.getImageData(0, 0, 1, 1).data : null;
        setComposited({ tex, solid: px ? `rgb(${px[0]}, ${px[1]}, ${px[2]})` : "#ffffff" });
      } catch (e) {
        // 73회차 — **사유를 인쇄한다.** 71회차에는 조용히 삼켜서 「왜 체커로 떨어졌는가」를
        // 못 봤다(71회차에 고친 판별자 결함과 같은 계열 — 실패 경로가 말이 없으면 계기가 아니다).
        console.warn("[71계기·합성 실패 → 체커 폴백]", e);
        if (alive) setComposited(null);
      }
    })();
    return () => { alive = false; if (made) made.dispose(); };
  }, [garmentImage, geos]);

  // **B** — 패널 인덱스(`patternGarment.ts:39-43` FRONT=0 / BACK=1 / SLEEVE_L=2 / SLEEVE_R=3)를
  // 그대로 쓴다. 머티리얼 인스턴스는 이미 메시마다 별개다(70 §5-2) — 배선만 바꾼다.
  const panelSurface = (i: number): { map: THREE.Texture | null; color: string } => {
    if (composited) return i === 0 ? { map: composited.tex, color: "#ffffff" } : { map: null, color: composited.solid };
    return { map: texture, color: "#ffffff" }; // 업로드 없음·합성 실패 → 기존 경로 그대로(체커 폴백)
  };

  useEffect(() => {
    let alive = true;
    void (async () => {
      // 동적 import — patternCore off 실행에 fixture(1.7MB)와 패턴 코드가
      // 번들에 들어가지 않게 한다.
      const [{ deriveBodySkeleton }, { measureBody }, { buildPatternGarment }, { bakeBodySnapshot }, { MannequinCollisionMesh }, { mannequinBonesRef, mannequinRootRef, awaitMannequinSettled }] = await Promise.all([
        import("../lib/bodySkeleton"),
        import("../lib/bodyMeasure"),
        import("../lib/patternGarment"),
        import("../lib/bodySnapshot"),
        import("../lib/meshCollision"),
        import("../lib/mannequinRef"),
      ]);
      if (!alive) return;
      // ── P5 §1 — **워커와 같은 몸을 본다.** 여기가 옛 몸을 보면 정적 배치와 착장 결과의
      // 패턴이 서로 달라지고(정점 수까지 갈린다) 결과 반영이 거부된다.
      // 마네킹이 아직 안 붙었으면 커밋된 fixture로 되돌아간다(그때는 몸 슬라이더 미반영).
      // 포즈·단위 정규화·스케일 lerp가 «정착한 뒤»에 굽는다(마운트 직후는 T포즈다).
      // 프레임 수가 아니라 잔차로 판정한다 — mannequinRef 주석.
      const settle = await awaitMannequinSettled();
      if (!alive) return;
      const settled = settle.ok;
      if (!settled) console.warn(`[patternPreview] 마네킹 미정착(frames ${settle.frames} · 잔차 ${settle.residual.toExponential(2)}) — 커밋 fixture로 그린다`);
      const root = mannequinRootRef.current;
      const bones = mannequinBonesRef.current;
      const snap = settled && root && bones.left && bones.right
        ? bakeBodySnapshot({ root, bones, bodySize, garmentSize, sleeveType, fabric }, new MannequinCollisionMesh())
        : null;
      if (snap) {
        // P5b §1 실측(계기는 걷었다 · 값은 보고서에 등재): 라이브 몸과 커밋 fixture의
        // 정점 좌표 차이는 **평균 0.021mm · 최대 0.14mm**(15,882정점 전수 대조)다.
        // 그 0.14mm가 9채널을 움직인다 — 라이브 몸을 쓰는 한 기준선 A와 비트 일치는
        // 원리적으로 불가능하다(fixture는 과거 스냅샷, 라이브는 현재 마네킹).
        const pos = snap.fixture.collision.position;
        let mnY = Infinity, mxY = -Infinity, mnX = Infinity, mxX = -Infinity;
        for (let i = 0; i < pos.length; i += 3) {
          if (pos[i] < mnX) mnX = pos[i]; if (pos[i] > mxX) mxX = pos[i];
          if (pos[i + 1] < mnY) mnY = pos[i + 1]; if (pos[i + 1] > mxY) mxY = pos[i + 1];
        }
        // fixture(커밋본 · 가슴 슬라이더 100에서 구운 것) 대조 기준값 — P5 §3 실측분.
        console.log(
          `[P5진단] 라이브 몸 — 정점 ${pos.length / 3}(fixture 15882) · y ${mnY.toFixed(3)}~${mxY.toFixed(3)}(fixture 0.000~1.700) · x ${mnX.toFixed(3)}~${mxX.toFixed(3)}(fixture ±0.545)` +
          ` · 정착 frames ${settle.frames} 잔차 ${settle.residual.toExponential(2)} · 굽기 ${snap.bakeMs.toFixed(1)}ms · 캡슐 ${snap.capsuleMs.toFixed(2)}ms` +
          ` · topY ${snap.fixture.layout.topY.toFixed(4)}(1.4304) · centerZ ${snap.fixture.layout.centerZ.toFixed(5)}/${snap.fixture.collision.centerZ.toFixed(5)}(-0.02787) · 핀간격 ${Math.abs(snap.fixture.pose.pinLeft.x - snap.fixture.pose.pinRight.x).toFixed(5)}(0.45000)`,
        );
      }
      const f = (snap?.fixture ?? (await import("../../scripts/fixtures/collision-fixture.json")).default) as unknown as {
        pose: {
          pinLeft: { x: number; y: number; z: number };
          pinRight: { x: number; y: number; z: number };
          // P11 — `elbow`/`hand`는 P10이 실은 **선택** 필드다(구 fixture에는 없다).
          armLeft: { dir: { x: number; y: number; z: number }; trueShoulder: { x: number; y: number; z: number }; length: number; elbow?: { x: number; y: number; z: number }; hand?: { x: number; y: number; z: number } };
          armRight: { dir: { x: number; y: number; z: number }; trueShoulder: { x: number; y: number; z: number }; length: number; elbow?: { x: number; y: number; z: number }; hand?: { x: number; y: number; z: number } };
        };
        collision: {
          position: number[] | Float32Array;
          frontIndex: number[] | null;
          backIndex: number[] | null;
          wholeBodyIndex: number[] | null;
          capsules: { bottom: { y: number } }[];
          centerZ: number;
        };
      };
      if (!alive) return;
      const position = Float32Array.from(f.collision.position);
      const torsoIndex = Uint32Array.from([...(f.collision.frontIndex ?? []), ...(f.collision.backIndex ?? [])]);
      const wholeIndex = f.collision.wholeBodyIndex ? Uint32Array.from(f.collision.wholeBodyIndex) : null;
      const hemY = f.collision.capsules[f.collision.capsules.length - 1].bottom.y;
      const centerX = (f.pose.pinLeft.x + f.pose.pinRight.x) / 2;
      const arms = [f.pose.armLeft, f.pose.armRight] as const;
      const skeleton = deriveBodySkeleton(position, torsoIndex, [f.pose.armLeft, f.pose.armRight], centerX, f.collision.centerZ, hemY);
      const body = measureBody(position, torsoIndex, wholeIndex, arms, skeleton, hemY, centerX, f.collision.centerZ);
      // ── P11 §1 상설 계기 — 팔 축 수직 단면 둘레(**표면 교선 그대로** · 볼록화 없음).
      // 커프 제도의 입력이 될 값이라 매번 임시 로그를 넣지 않도록 여기 둔다.
      {
        const a = body.armSection;
        const cm = (v: number | null): string => (v === null ? "산출불가" : `${(v * 100).toFixed(2)}cm`);
        console.log(a
          ? `[patternPreview·P11] 팔 단면(표면 교선) — 위팔 ${cm(a.upperSectionGirthM)} · 팔꿈치 ${cm(a.elbowSectionGirthM)}` +
            ` · 전완 ${cm(a.foreSectionGirthM)} · 손목 ${cm(a.wristSectionGirthM)}(호장 ${a.wristAtSM === null ? "—" : (a.wristAtSM * 100).toFixed(1) + "cm"})` +
            ` · 위팔길이 ${(a.upperArmLenM * 100).toFixed(1)}cm / 전완길이 ${(a.foreArmLenM * 100).toFixed(1)}cm` +
            ` · 표본 ${a.valid}/${a.sampled}(간격 ${(a.stepM * 1000).toFixed(0)}mm)` +
            // 어깨 근방 오염 감시 — 축 지점이 아직 몸통 안이면 「팔 고리」로 몸통이 뽑힐 수
            // 있다. 최대가 어깨 쪽(s≈0)에서 몸통급 값으로 튀면 여기서 드러난다(함정 18: 단일 요약 금지).
            ` · 최대 ${cm(a.maxSectionGirthM)}@s=${a.maxAtSM === null ? "—" : (100 * a.maxAtSM).toFixed(1) + "cm"}`
          : "[patternPreview·P11] 팔 단면 — **산출 불가**(팔꿈치·손 좌표 없음 = 구 fixture 또는 전신 인덱스 없음)");
      }
      const outlineTorso = new ArrayBvhCollision();
      outlineTorso.rebuild(position, torsoIndex);
      const outlineWhole = new ArrayBvhCollision();
      outlineWhole.rebuild(position, wholeIndex ?? torsoIndex);
      const g = buildPatternGarment(
        body,
        {
          lengthM: garmentSize.length / 100,
          widthM: garmentSize.width / 100,
          // P3 §1 — **어깨너비만 fixture 포즈에서 온다**(핀 간격 44.9995cm).
          // 슬라이더(기본 45cm)를 쓰면 워커가 그리는 옷과 여기 정적 배치가 서로 다른
          // 패턴이 되고, 기본값에서 기준선 A도 깨진다. 워커와 «같은 옷»을 그려야 한다.
          shoulderWidthM: Math.abs(f.pose.pinLeft.x - f.pose.pinRight.x),
          sleeveLengthM: garmentSize.sleeveLength / 100,
          sleeveWidthM: garmentSize.sleeveWidth / 100,
        },
        arms,
        makeOutlineProvider(
          outlineTorso, outlineWhole,
          (h) => { const sl = body.slices.reduce((b, s2) => (Math.abs(s2.y - h) < Math.abs(b.y - h) ? s2 : b), body.slices[0]); return [sl.axisX, sl.axisZ]; },
          PATTERN_EDGE_INTERIOR_M,
        ),
      );
      if (!alive) return;

      if (useDressState) try {
        // 정적 import가 아니라 **런타임 fetch**다 — 덤프는 실행 산출물이라
        // 커밋되지 않고, 정적 import로 두면 파일이 없을 때 tsc·빌드가 깨진다.
        const res = await fetch("/dress-state.json");
        if (!res.ok) {
          console.warn("[patternPreview] dress-state.json 없음 — npm run dress:pattern 먼저 실행. 정적 배치를 그린다.");
          throw new Error("no dump");
        }
        const st = (await res.json()) as { positions: number[]; frames: number; state: string; patternHash: string };
        if (st.positions.length === g.positions.length) {
          g.positions.set(Float32Array.from(st.positions));
          console.log(`[patternPreview] 착장 최종 상태 로드 — ${st.state} @ ${st.frames}프레임 · pattern ${st.patternHash}`);
        } else {
          console.warn(`[patternPreview] 덤프 정점 수 불일치(${st.positions.length / 3} vs ${g.positions.length / 3}) — 정적 배치를 그린다`);
        }
      } catch { /* 덤프 없음·불일치 — 정적 배치로 진행 */ }

      const out: THREE.BufferGeometry[] = [];
      for (let p = 0; p < 4; p++) {
        const start = g.panelStarts[p];
        const count = g.panelCounts[p];
        const pos = new Float32Array(count * 3);
        const uv = new Float32Array(count * 2);
        pos.set(g.positions.subarray(start * 3, (start + count) * 3));
        uv.set(g.uv.subarray(start * 2, (start + count) * 2));
        const range = g.panelTriRanges[p];
        const idx = new Uint32Array(range.count * 3);
        for (let i = 0; i < range.count * 3; i++) idx[i] = g.tris[range.start * 3 + i] - start;
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
        geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
        geo.setIndex(new THREE.BufferAttribute(idx, 1));
        geo.computeVertexNormals();
        out.push(geo);
      }
      // 48회차 clean — 시접 쌍의 법선을 평균해 **패널 경계 법선 불연속을 없앤다**.
      // 위치는 안 건드린다. 패널 로컬 인덱스로 되돌려 써야 한다(geo는 패널별이다).
      if (cleanRender) {
        const panelOf = (gi: number): number => {
          for (let p = 3; p >= 0; p--) if (gi >= g.panelStarts[p]) return p;
          return 0;
        };
        for (const sm of g.seams) {
          const pa = panelOf(sm.a), pb = panelOf(sm.b);
          const na = out[pa].getAttribute("normal") as THREE.BufferAttribute;
          const nb = out[pb].getAttribute("normal") as THREE.BufferAttribute;
          const ia = sm.a - g.panelStarts[pa], ib = sm.b - g.panelStarts[pb];
          const x = (na.getX(ia) + nb.getX(ib)) / 2, y = (na.getY(ia) + nb.getY(ib)) / 2, z = (na.getZ(ia) + nb.getZ(ib)) / 2;
          const l = Math.hypot(x, y, z) || 1;
          na.setXYZ(ia, x / l, y / l, z / l);
          nb.setXYZ(ib, x / l, y / l, z / l);
        }
        for (const geo of out) (geo.getAttribute("normal") as THREE.BufferAttribute).needsUpdate = true;
        console.log(`[patternPreview] **cleanrender=1** — 시접 ${g.seams.length}쌍 법선 용접 · 브리지 숨김 · 위치 불변(캡처 전용)`);
      }
      // ── 시접 브리지 (§3.4) — v1 기계(`seamBridge.ts`)를 **무수정**으로 재사용한다.
      // 패널 4매를 별개 지오메트리로 그리므로 시접 rest 6mm 간격이 화면에 그대로
      // 세로 틈으로 보인다(2b 6·7회차 관측: 물리적으로는 4.9~9.1mm로 닫혀 있다).
      // v1은 격자 인덱스로 쌍을 만들었지만 패턴 코어는 **시접 테이블이 이미
      // 경계 순서대로** 쌍을 들고 있다(`seamGroups.a/b` = 세그먼트 정점 목록을
      // 같은 순서로 짝지은 것) — 그대로 스트립이 된다. 순서가 곧 사각형 연결
      // 순서라 정렬 로직이 필요 없다.
      //
      // SeamSource 4종은 v1이 패널마다 배열이 따로였기 때문인데, 패턴 코어는
      // 전 패널이 한 배열(전역 인덱스)이다 — 네 소스에 같은 배열을 넘기고
      // 전역 인덱스를 그대로 쓴다. 기계는 손대지 않는다.
      const strips: SeamStrip[] = g.seamGroups.map((grp) => ({
        name: grp.label,
        pairs: grp.a.map((ai, k) => ({
          a: { source: "front" as const, index: ai },
          b: { source: "front" as const, index: grp.b[k] },
        })),
        closed: false,
      }));
      const bridge = buildSeamBridge(strips);
      const one = g.positions;
      updateSeamBridge(bridge, { front: one, back: one, sleeveLeft: one, sleeveRight: one });
      setBridgeGeo(bridge.geometry);
      liveRef.current = { bridge, starts: [...g.panelStarts], counts: [...g.panelCounts], total: g.positions.length / 3 };

      setGeos(out);
      const byKind = g.seamGroups.reduce<Record<string, number>>((acc, grp) => {
        acc[grp.kind] = (acc[grp.kind] ?? 0) + grp.a.length;
        return acc;
      }, {});
      console.log(
        `[patternPreview] 정적 배치 렌더 — 정점 ${g.panelCounts.reduce((a, b) => a + b, 0)} · 삼각형 ${g.tris.length / 3} · 시접 ${g.seams.length}쌍 · 자기충돌 문턱 ${(g.selfCollisionMinDistM * 1000).toFixed(2)}mm`,
      );
      console.log(
        `[patternPreview] 시접 브리지 — 스트립 ${strips.length}개 · 쌍 ${strips.reduce((a, s) => a + s.pairs.length, 0)} · 삼각형 ${strips.reduce((a, s) => a + Math.max(0, s.pairs.length - 1) * 2, 0)} · 종류별 쌍 ${JSON.stringify(byKind)}`,
      );
    })();
    return () => { alive = false; };
  }, [garmentSize, bodySize, sleeveType, fabric, useDressState, cleanRender]);

  // P2c(f) — 「착장하기」 결과 반영. `?patternstate=1`의 옛 fetch 경로와 **병존**한다.
  useEffect(() => {
    const onResult = (ev: Event): void => {
      const d = (ev as CustomEvent<{ positions: Float32Array }>).detail;
      const live = liveRef.current;
      if (!geos || !live || !d?.positions) return;
      if (d.positions.length !== live.total * 3) {
        console.warn(`[patternPreview] 착장 결과 정점 수 불일치(${d.positions.length / 3} vs ${live.total}) — 반영하지 않는다`);
        return;
      }
      for (let p = 0; p < geos.length; p++) {
        const attr = geos[p].getAttribute("position") as THREE.BufferAttribute;
        (attr.array as Float32Array).set(d.positions.subarray(live.starts[p] * 3, (live.starts[p] + live.counts[p]) * 3));
        attr.needsUpdate = true;
        geos[p].computeVertexNormals();
        geos[p].computeBoundingSphere();
      }
      updateSeamBridge(live.bridge, { front: d.positions, back: d.positions, sleeveLeft: d.positions, sleeveRight: d.positions });
      console.log("[patternPreview] 착장 결과 반영 — 정점 좌표만 갱신(위상·UV 불변)");
    };
    window.addEventListener(DRESS_RESULT_EVENT, onResult);
    return () => window.removeEventListener(DRESS_RESULT_EVENT, onResult);
  }, [geos]);

  if (!geos) return null;
  return (
    <group>
      {geos.map((geo, i) => {
        const sf = panelSurface(i);
        return (
          <mesh key={i} geometry={geo}>
            <meshStandardMaterial map={sf.map} color={sf.color} side={THREE.DoubleSide} roughness={0.85} />
          </mesh>
        );
      })}
      {/* 브리지는 체커 텍스처를 안 쓴다 — UV가 없고(띠는 패널 UV 밖이다), 시접이
          어디를 메웠는지 눈으로 구분되는 게 이 단계의 목적이다.
          색은 **75회차부터 원단 대표색**(`composited.solid` — 합성 캔버스 (0,0) 픽셀)이고
          업로드가 없으면 저채도 회청 `#6b7f8c`로 폴백한다.
          그 회청은 21회차에 주황(#c8641e)을 대체하며 고른 값인데, **체커 기준선에 맞춰
          고른 값**이라(함정14) 실물 검정 원단에서는 화면 최대 결함이 됐다(72회차 실측:
          색거리 2.0배 · 화면 밝기 38배). v1은 처음부터 대표색을 도출해 쓴다
          (`Garment.tsx:327`) — 75회차는 **v2가 안 하던 것을 맞춘 것**이고 손 상수 순증감 −1이다.
          렌더 전용이라 물리·게이트는 무관. */}
      {bridgeGeo && !cleanRender && (
        <mesh geometry={bridgeGeo} frustumCulled={false}>
          <meshStandardMaterial key="pattern-seam-bridge" color={composited ? composited.solid : "#6b7f8c"} side={THREE.DoubleSide} roughness={0.85} />
        </mesh>
      )}
    </group>
  );
}
