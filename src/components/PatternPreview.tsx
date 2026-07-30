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
import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { useFitStore } from "../store/useFitStore";
import { buildSeamBridge, updateSeamBridge, type SeamStrip } from "./seamBridge";

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

export function PatternPreview(): React.JSX.Element | null {
  const garmentSize = useFitStore((s) => s.garmentSize);
  // `?patternstate=1` — 2b 하네스가 남긴 최종 상태(시뮬 결과)를 그린다.
  // 없으면 2a 정적 배치를 그린다. 물리는 여전히 여기서 돌지 않는다.
  const useDressState = new URLSearchParams(window.location.search).get("patternstate") === "1";
  const [geos, setGeos] = useState<THREE.BufferGeometry[] | null>(null);
  const [bridgeGeo, setBridgeGeo] = useState<THREE.BufferGeometry | null>(null);
  const texture = useMemo(() => makeCheckerTexture(), []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      // 동적 import — patternCore off 실행에 fixture(1.7MB)와 패턴 코드가
      // 번들에 들어가지 않게 한다.
      const [{ deriveBodySkeleton }, { measureBody }, { buildPatternGarment }, fixtureMod] = await Promise.all([
        import("../lib/bodySkeleton"),
        import("../lib/bodyMeasure"),
        import("../lib/patternGarment"),
        import("../../scripts/fixtures/collision-fixture.json"),
      ]);
      if (!alive) return;
      const f = fixtureMod.default as unknown as {
        pose: {
          pinLeft: { x: number; y: number; z: number };
          pinRight: { x: number; y: number; z: number };
          armLeft: { dir: { x: number; y: number; z: number }; trueShoulder: { x: number; y: number; z: number }; length: number };
          armRight: { dir: { x: number; y: number; z: number }; trueShoulder: { x: number; y: number; z: number }; length: number };
        };
        collision: {
          position: number[];
          frontIndex: number[] | null;
          backIndex: number[] | null;
          wholeBodyIndex: number[] | null;
          capsules: { bottom: { y: number } }[];
          centerZ: number;
        };
      };
      const position = Float32Array.from(f.collision.position);
      const torsoIndex = Uint32Array.from([...(f.collision.frontIndex ?? []), ...(f.collision.backIndex ?? [])]);
      const wholeIndex = f.collision.wholeBodyIndex ? Uint32Array.from(f.collision.wholeBodyIndex) : null;
      const hemY = f.collision.capsules[f.collision.capsules.length - 1].bottom.y;
      const centerX = (f.pose.pinLeft.x + f.pose.pinRight.x) / 2;
      const arms = [f.pose.armLeft, f.pose.armRight] as const;
      const skeleton = deriveBodySkeleton(position, torsoIndex, [f.pose.armLeft, f.pose.armRight], centerX, f.collision.centerZ, hemY);
      const body = measureBody(position, torsoIndex, wholeIndex, arms, skeleton, hemY, centerX, f.collision.centerZ);
      const g = buildPatternGarment(
        body,
        {
          lengthM: garmentSize.length / 100,
          widthM: garmentSize.width / 100,
          shoulderWidthM: garmentSize.shoulderWidth / 100,
          sleeveLengthM: garmentSize.sleeveLength / 100,
          sleeveWidthM: garmentSize.sleeveWidth / 100,
        },
        arms,
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
  }, [garmentSize, useDressState]);

  if (!geos) return null;
  return (
    <group>
      {geos.map((geo, i) => (
        <mesh key={i} geometry={geo}>
          <meshStandardMaterial map={texture} side={THREE.DoubleSide} roughness={0.85} />
        </mesh>
      ))}
      {/* 브리지는 체커 텍스처를 안 쓴다 — UV가 없고(띠는 패널 UV 밖이다), 시접이
          어디를 메웠는지 눈으로 구분되는 게 이 단계의 목적이다. */}
      {bridgeGeo && (
        <mesh geometry={bridgeGeo} frustumCulled={false}>
          <meshStandardMaterial key="pattern-seam-bridge" color="#c8641e" side={THREE.DoubleSide} roughness={0.85} />
        </mesh>
      )}
    </group>
  );
}
