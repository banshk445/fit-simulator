// 데모 경로 스모크 테스트 — `npm run check:demo`
//
// 왜 만들었나: M1에서 렌더 경로를 용접 직결로 바꿀 때 **핏 맵이 조용히
// 죽었다**. README가 광고하는 5단계 중 3단계가 비어 있었는데 지표는 전부
// 통과였고, 화면 판정도 기본 상태(핏 맵 off)만 봐서 몇 달을 못 잡았다.
// 같은 종류의 "기능이 조용히 빠짐"을 프레임워크 없이 잡는다.
//
// 브라우저를 띄우지 않는다(Playwright 금지). 대신 렌더가 실제로 쓰는
// 모듈을 Node에서 직접 돌려 결과 버퍼를 검사하고, 화면 배선처럼 Node에서
// 못 돌리는 부분은 **소스에서 구조적 불변식**을 확인한다.
import { readFileSync, readdirSync } from "node:fs";
import { buildWeldedGarmentGeometry } from "../src/components/weldedGarmentGeometry";
import { buildTrimBand, type TrimRing } from "../src/components/trimBands";
import * as THREE from "three";
import { pointBoneTowardWorldDirection } from "../src/lib/boneUtils";
import { COLS, ROWS } from "../src/lib/clothConfig";

let failed = 0;
const check = (ok: boolean, label: string, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed++;
};

// ── 1. 핏 맵이 실제로 색을 만드는가 ──────────────────────────────────
{
  const welded = buildWeldedGarmentGeometry(10, 33);
  const n = COLS * ROWS;
  // 여유(cm) 램프: 관통(-1) ~ 헐렁(5). 색 경계가 0/1/3cm이라 네 구간을 다 지난다.
  const front = new Float32Array(n).map((_, i) => -1 + (6 * i) / (n - 1));
  const back = new Float32Array(n).fill(2);
  welded.setFit(front, back);
  const color = welded.geometry.getAttribute("color").array as Float32Array;
  const keys = new Set<string>();
  for (let i = 0; i < n; i++) {
    keys.add([color[i * 3], color[i * 3 + 1], color[i * 3 + 2]].map((v) => v.toFixed(2)).join(","));
  }
  let allWhite = true;
  let anyBlack = false;
  for (let i = 0; i < n * 3; i += 3) {
    if (color[i] !== 1 || color[i + 1] !== 1 || color[i + 2] !== 1) allWhite = false;
    if (color[i] === 0 && color[i + 1] === 0 && color[i + 2] === 0) anyBlack = true;
  }
  check(keys.size > 20, "핏 맵 정점색이 여유에 따라 변한다", `서로 다른 색 ${keys.size}종`);
  check(!allWhite, "핏 맵이 흰색으로 방치되지 않는다");
  check(!anyBlack, "핏 맵에 검은 정점이 없다(color 속성 누락 사고 재발 방지)");
  welded.dispose();
}

// ── 2. 트림 밴드가 실제 폭을 가진 띠인가 ────────────────────────────
{
  const RING = 24;
  // 반지름 10cm 원형 링(목선), 안쪽 행은 3cm 아래.
  const ring: TrimRing = {
    name: "t",
    count: RING,
    read: (out, i) => {
      const a = (i / RING) * Math.PI * 2;
      out[0] = Math.cos(a) * 0.1;
      out[1] = 1.4;
      out[2] = Math.sin(a) * 0.1;
    },
    readInner: (out, i) => {
      const a = (i / RING) * Math.PI * 2;
      out[0] = Math.cos(a) * 0.1;
      out[1] = 1.4 - 0.03;
      out[2] = Math.sin(a) * 0.1;
    },
  };
  const widthOf = (band: ReturnType<typeof buildTrimBand>) => {
    band.update();
    const p = band.geometry.getAttribute("position").array as Float32Array;
    let w = 0;
    for (let i = 0; i < RING; i++) {
      const o = i * 6;
      w = Math.max(w, Math.hypot(p[o] - p[o + 3], p[o + 1] - p[o + 4], p[o + 2] - p[o + 5]));
    }
    return w;
  };
  const neck = buildTrimBand([ring], { surfaceInset: 0.9, lift: 0.0015 });
  const cuff = buildTrimBand([ring], { extrude: 0.025 });
  const wn = widthOf(neck);
  const wc = widthOf(cuff);
  check(wn > 0.02 && wn < 0.04, "넥밴드 스트립 폭이 2~4cm", `${(wn * 100).toFixed(1)}cm`);
  check(wc > 0.02 && wc < 0.03, "커프 밴드 폭이 2~3cm", `${(wc * 100).toFixed(1)}cm`);
  neck.dispose();
  cuff.dispose();
}

// ── 3. 화면 배선 — 소스 구조적 불변식 ───────────────────────────────
{
  const src = readFileSync("src/components/Garment.tsx", "utf8");

  // (a) 신 코어 머티리얼이 showFitMap을 실제로 소비하는가.
  //     M1 사고가 정확히 이것 — 렌더 경로를 갈아끼우며 이 배선이 빠졌다.
  check(
    /vertexColors=\{showFitMap\}/.test(src),
    "신 코어 머티리얼이 showFitMap을 소비한다",
  );
  check(/setFit\(msg\.frontFit, msg\.backFit\)/.test(src), "워커 여유 데이터가 신 코어로 흘러간다");

  // (b) 몸 치수 의존성 — 충돌 메시를 다시 굽는 조건이면 옷도 다시 지어야
  //     한다. 가슴이 한쪽에만 있어서 몸이 커져도 재단이 그대로였다.
  const deps = [...src.matchAll(/\}, \[([^\]]*)\]\);/g)].map((m) => m[1]);
  const bodyKeys = (t: string) => new Set([...t.matchAll(/bodySize\.(\w+)/g)].map((m) => m[1]));
  const lists = deps.map(bodyKeys).filter((s) => s.size > 0);
  check(lists.length >= 2, "몸 치수를 의존성으로 쓰는 useEffect가 둘 이상", `${lists.length}개`);
  // legLength는 예외 — 다리 길이는 상의의 재단·핀에 아무 영향이 없다.
  // (충돌 메시는 몸 전체라 다시 구워야 한다.)
  const IRRELEVANT_TO_GARMENT = new Set(["legLength"]);
  const union = new Set(lists.flatMap((s) => [...s]).filter((k) => !IRRELEVANT_TO_GARMENT.has(k)));
  const missing = lists
    .map((s) => [...union].filter((k) => !s.has(k)))
    .flat();
  check(
    missing.length === 0,
    "몸 치수 의존성 목록이 서로 일치한다",
    missing.length ? `빠진 항목: ${[...new Set(missing)].join(", ")}` : `공통 ${[...union].join(", ")}`,
  );
}

// ── 4. 마네킹 본 회전 누적이 발산하지 않는가 ────────────────────────
// 가슴둘레 슬라이더가 몸통 본에 비균등 스케일을 걸면 getWorldQuaternion이
// 단위가 아닌 쿼터니언을 뽑고, 그게 매 프레임 누적 곱해져 지수로 발산했다
// (가슴 101에서 25초 뒤 팔 정점 38.9%가 Float32 포화). 정규화가 빠지면
// 이 검사가 바로 깨진다.
{
  // 비균등 스케일 **위에 회전이 섞여야** 분해가 순수 회전이 아니게 된다 —
  // 축 정렬 스케일만으로는 getWorldQuaternion이 단위 쿼터니언을 돌려줘
  // 발산이 재현되지 않는다(실제 본 체인은 스케일된 몸통 아래 회전된
  // 어깨/팔이 달려 있다).
  const root = new THREE.Object3D();
  root.scale.set(1.2, 1.0, 1.35); // 가슴둘레 스케일이 만드는 상황
  const parent = new THREE.Object3D();
  parent.rotation.set(0.4, 0.5, 0.3);
  const bone = new THREE.Object3D();
  const child = new THREE.Object3D();
  child.position.set(0, -0.3, 0);
  bone.add(child);
  parent.add(bone);
  root.add(parent);
  root.updateWorldMatrix(true, true);
  const cur = new THREE.Vector3();
  const target = new THREE.Vector3(0.6, -1, 0).normalize();
  for (let i = 0; i < 300; i++) {
    bone.updateWorldMatrix(true, false);
    child.updateWorldMatrix(true, false);
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    bone.getWorldPosition(a);
    child.getWorldPosition(b);
    cur.copy(b).sub(a).normalize();
    pointBoneTowardWorldDirection(bone, cur, target);
  }
  child.updateWorldMatrix(true, false);
  const w = new THREE.Vector3();
  child.getWorldPosition(w);
  const q = bone.quaternion.length();
  check(Math.abs(q - 1) < 1e-3, "본 쿼터니언이 단위로 유지된다(누적 발산 없음)", `|q| = ${q.toFixed(6)}`);
  check(Number.isFinite(w.x) && w.length() < 10, "비균등 스케일 300프레임 뒤에도 팔 좌표가 유한", `|p| = ${w.length().toFixed(3)}`);
}

// ── 5. 커밋된 fixture에 손상값이 없는가 ─────────────────────────────
{
  const dir = "scripts/fixtures";
  for (const name of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    const pos: number[] = JSON.parse(readFileSync(`${dir}/${name}`, "utf8")).collision?.position ?? [];
    let bad = 0;
    for (const v of pos) if (!Number.isFinite(v) || Math.abs(v) > 1e6) bad++;
    check(pos.length > 0 && bad === 0, `fixture ${name} 좌표 정상`, bad ? `비정상 ${bad}개` : `${pos.length / 3}정점`);
  }
}

console.log(failed === 0 ? "[checkDemoSmoke] PASS" : `[checkDemoSmoke] FAIL ${failed}건`);
process.exit(failed === 0 ? 0 : 1);
