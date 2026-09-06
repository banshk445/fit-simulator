/* v4-40 §1-② — **A포즈 그리드 몸 27칸 브라우저 하네스**(신설 파일 · 물리 0줄 · 몸 생성은 승혁이 실행).
 *
 * 왜 브라우저인가 — 27칸은 «슬라이더가 만든 몸»이다. 치수(가슴·키·어깨)는 `Mannequin.tsx` 의
 * 뼈 배율 lerp 로만 걸리고 그 루프는 React 씬 안에서 돈다 ⟹ Node 경로(`scripts/v4Apose.ts`)는
 * **기본 몸 하나**밖에 못 만든다. 그래서 v3-77·83·85 가 T포즈 27칸을 구운 «그 하네스»를 그대로 따르고,
 * 포즈만 A포즈 규칙으로 바꾼다.
 *
 * 이 파일이 «부르는» 것(식 신설 0 · 전부 기존 경로):
 * ```
 *  src/v3/grid.ts            bodies() · bodyIdOf() · FIXED       ← 27칸 목록(Node 와 같은 목록)
 *  src/components/BakeMount  stepFrames                          ← 프레임 전진(하네스 층)
 *  src/lib/mannequinRef      mannequinRootRef · poseStopped · mannequinPoseRef · POSE_SETTLE_EPS
 *  src/components/bodyInjectBake.ts  bakeBodyVerts(glb, root, "apose")
 *  src/lib/boneUtils.ts      findArmRootBones · findHandBone · findArmDirection · setBoneTowardWorldDirection
 * ```
 * **A포즈 규칙은 `scripts/v4Apose.ts:75-85` 와 «같은 줄»이다** — 팔 축을 뼈에서 읽어 월드 z 둘레로
 * `DEG`(기본 35°) 내린다. 다만 브라우저에는 제품 A포즈(`Mannequin.tsx:265` `outwardDown` 0.6)가
 * 이미 걸려 있으므로, **바인드 자세로 되돌린 «뒤»** 규칙을 적용한다 —
 * 되돌리는 세 줄은 `bodyInjectBake.ts:97-105`(`userData.__p27Bind`)와 같은 것이고 **뼈 배율은 건드리지 않는다**
 * (슬라이더가 만든 치수가 그대로 남는다).
 *
 * 게이트·문턱은 **전부 인용**이다(이 파일이 새로 정한 수 0):
 *   ㉮ 전진 상한 **600 프레임**(v3-83 `bakeGrid` 와 같은 수) ⟹ 도달하면 그 칸 **실패 · 저장 0**
 *   ㉯ 수렴 = `poseStopped() && mannequinPoseRef.maxScaleResidual <= POSE_SETTLE_EPS` **연속 2프레임**
 *      (v3-83 과 같은 절 · `POSE_SETTLE_EPS` 는 `src/lib/mannequinRef` 의 기존 상수)
 *   ㉰ 반출은 **수신기 경유**(`scripts/v3Receiver.ts` · sha256 대조 뒤에만 저장 · 자동 다운로드 금지 규약)
 *
 * 산출(칸마다 3개 · 이름은 v4 소비자가 그대로 읽는 형식):
 *   `l3ap-body-<id>-a<deg>.bin`   Float32 3n — `ARM_AXIS_JSON` 과 짝이 되는 몸
 *   `l3ap-body-<id>-a<deg>.json`  `팔축_후` 를 담는다(`scripts/armAxisEnv.ts` 가 읽는 필드)
 *   `l3ap-origin-<id>-a<deg>.json` `피벗`·`중심선투영`(`armAxisEnv` 의 `ARM_ORIGIN_JSON`)
 */
import { useCallback, useState } from "react";
import * as THREE from "three";
import { mannequinRootRef, mannequinPoseRef, poseStopped, POSE_SETTLE_EPS } from "../lib/mannequinRef";
import { stepFrames, bakeMountFrames } from "./BakeMount.tsx";
import { bakeBodyVerts } from "./bodyInjectBake.ts";
import { findArmRootBones, findHandBone, findArmDirection, setBoneTowardWorldDirection } from "../lib/boneUtils.ts";
import { bodies, bodyIdOf, FIXED } from "../v3/grid.ts";
import { useFitStore } from "../store/useFitStore";

/** 회차 규약값 — A포즈 각도. `?apodeg=` 로만 바뀐다(기본은 v4 트랙의 35°). */
const DEFAULT_DEG = 35;
const CAP_FRAMES = 600;                                   // v3-83 `bakeGrid` 인용
const PORT = 5199;                                        // `scripts/v3Receiver.ts` 기본 포트

type Row = { id: string; 결과: "통과" | "실패" | "던짐"; 전진프레임: number; 굽기잔차: number;
             높이m: number; sha256: string; 반출: string; 사유?: string; 잔차궤적?: string };

/* ★ v4-41 §1-② — **프레임 «펌프»**. v4-40 은 `stepFrames` 만 불렀고, 그 함수는 R3F `advance(t)` 뿐이다.
 * `BakeMount.tsx:38-46` 이 등재한 사실: **루트가 없으면 `advance` 는 조용히 아무 것도 안 한다**
 * (advance 1,620,000회에 `useFrame` 0회). v3-83 은 그 위험을 «절차»(가시화 계기 1회)로 막았는데
 * v4-40 의 절차서가 그 단계를 빠뜨렸고, 27칸이 «프레임 0» 인 채로 상한 600 을 태웠다.
 * ⟹ 여기서는 **프레임이 실제로 돌았는지 계수기로 확인**하고(`bakeMountFrames`),
 *   안 돌면 **브라우저의 자연 루프(rAF)** 로 한 프레임을 얻는다. 문턱·물리 0줄. */
async function pump(): Promise<boolean> {
  /* 진행의 «판정 채널»은 `mannequinPoseRef.frames` 다 — 그 값을 올리는 것은
   * `Mannequin.tsx:454` 의 스케일 루프이고, 그것이 곧 「수렴이 진행됐는가」의 생산자다
   * (`bakeMountFrames` 는 BakeMount 캔버스 «하나»만 세므로 보조 지표로만 인쇄한다). */
  const before = mannequinPoseRef.frames;
  stepFrames(1);
  if (mannequinPoseRef.frames > before) return true;      // 동기 전진이 먹었다(v3-83 경로)
  await new Promise<void>((r) => requestAnimationFrame(() => r()));
  return mannequinPoseRef.frames > before;                // 자연 루프(rAF)가 돌았는가
}

/** 가시화 계기 — R3F 루트 생성 조건(v3-71 §2 ⑥). 스크롤·리사이즈로 페인트를 «유발»만 한다. */
async function kick(): Promise<void> {
  document.querySelector("[data-bakemount]")?.scrollIntoView({ block: "nearest" });
  window.dispatchEvent(new Event("resize"));
  for (let i = 0; i < 3; i++) await new Promise<void>((r) => requestAnimationFrame(() => r()));
}

const sha256Hex = async (buf: ArrayBuffer) => {
  const h = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(h)].map((x) => x.toString(16).padStart(2, "0")).join("");
};

/** 수신기로 보낸다 — sha 는 여기서 계산해 함께 싣고, 대조는 수신기가 한다(v3-86 규약). */
async function send(name: string, bytes: Uint8Array): Promise<string> {
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const sha = await sha256Hex(ab);
  const r = await fetch(`http://127.0.0.1:${PORT}/put?name=${name}&sha256=${sha}`, { method: "POST", body: ab });
  if (!r.ok) throw new Error(`수신기 ${r.status} — ${await r.text()}`);
  return sha;
}

export function V4AposeGrid() {
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState("");

  const run = useCallback(async () => {
    const q = new URLSearchParams(window.location.search);
    const DEG = Number(q.get("apodeg") ?? DEFAULT_DEG);
    const dry = q.get("apodry") === "1";                   // 드라이런 — 반출 0(행만 만든다)
    const only = q.get("apoonly");                         // 한 칸만
    setBusy(true); setRows([]);
    const glb = await (await fetch(`${import.meta.env.BASE_URL}models/mannequin.glb`)).arrayBuffer();
    const st = () => useFitStore.getState();
    st().setArmLength(FIXED.armLength); st().setLegLength(FIXED.legLength);
    const list = bodies().filter((b) => !only || bodyIdOf(b) === only);
    const out: Row[] = [];
    /* ★ v4-41 §1-② — **펌프 자가진단**. 프레임이 안 돌면 27칸을 태우지 않고 여기서 멈춘다. */
    await kick();
    const t0 = mannequinPoseRef.frames, b0 = bakeMountFrames.current;
    for (let i = 0; i < 3; i++) await pump();
    const pumped = mannequinPoseRef.frames - t0;
    console.log(`[v4-41] 펌프 자가진단 — 3회 요청에 스케일 루프 ${pumped}회`
      + ` · BakeMount useFrame ${bakeMountFrames.current - b0}회`
      + ` · 잔차 ${mannequinPoseRef.maxScaleResidual.toExponential(2)}`);
    if (pumped === 0) {
      setNow("**정지** — 프레임이 돌지 않는다(가시화 계기 필요). 이 탭을 맨 앞에 두고 다시 누른다.");
      setRows([{ id: "(자가진단)", 결과: "실패", 전진프레임: 0, 굽기잔차: mannequinPoseRef.maxScaleResidual,
                 높이m: NaN, sha256: "", 반출: "0",
                 사유: "펌프 정지 — 스케일 루프가 한 번도 안 돈다(R3F 루트 부재 또는 비가시 탭)."
                   + " 27칸 착수 0 · 근거 BakeMount.tsx:38-46(루트가 없으면 advance 는 조용히 무동작)" }]);
      setBusy(false); return;
    }
    const ZAX = new THREE.Vector3(0, 0, 1);

    for (let i = 0; i < list.length; i++) {
      const b = list[i], id = bodyIdOf(b);
      setNow(`${i + 1}/${list.length} · ${id}`);
      st().setBodyChest(b.chest); st().setBodyHeight(b.height); st().setShoulderWidth(b.shoulder);
      await new Promise((r) => setTimeout(r, 0));
      /* ㉯ 수렴 — v3-83 과 같은 절(연속 2프레임 · 상한 600) · 전진은 **펌프**로 한다(v4-41). */
      let k = 0, hit = 0;
      const trail: string[] = [];
      while (k < CAP_FRAMES) {
        const ok = await pump(); k += 1;
        if (k === 1 || k === 10 || k === 50 || k === CAP_FRAMES)
          trail.push(`f${k}:${mannequinPoseRef.maxScaleResidual.toExponential(2)}${ok ? "" : "(정지)"}`);
        if (poseStopped() && mannequinPoseRef.maxScaleResidual <= POSE_SETTLE_EPS) { hit += 1; if (hit >= 2) break; }
        else hit = 0;
      }
      const resid = mannequinPoseRef.maxScaleResidual;
      const root = mannequinRootRef.current;
      if (k >= CAP_FRAMES || !root) {
        out.push({ id, 결과: "실패", 전진프레임: k, 굽기잔차: resid, 높이m: NaN, sha256: "", 반출: "0",
                   잔차궤적: trail.join(" "),
                   사유: !root ? "살아있는 마네킹이 없다" : `㉮ 상한 ${CAP_FRAMES} 도달` });
        setRows([...out]); continue;
      }
      try {
        /* ① 바인드 복원 — `bodyInjectBake.ts:97-105` 와 같은 세 줄(배율은 손대지 않는다). */
        root.traverse((o) => {
          const bone = o as THREE.Object3D & { userData: { __p27Bind?: THREE.Quaternion } };
          if (bone.userData.__p27Bind) bone.quaternion.copy(bone.userData.__p27Bind);
        });
        root.updateMatrixWorld(true);
        /* ② A포즈 규칙 — `scripts/v4Apose.ts:79-85` 와 같은 줄. */
        const nodes: Record<string, THREE.Object3D> = {};
        root.traverse((o) => { nodes[o.name] = o; });
        const arms = findArmRootBones(nodes);
        if (arms.length === 0) throw new Error("팔 뿌리 뼈를 못 찾는다 — 리그가 다르다");
        for (const a of arms) {
          const d = findArmDirection(a);
          const sgn = d.x >= 0 ? 1 : -1;
          const target = d.clone().applyAxisAngle(ZAX, -sgn * (DEG * Math.PI) / 180).normalize();
          setBoneTowardWorldDirection(a, findHandBone(a), target);
        }
        root.updateMatrixWorld(true);
        /* ③ 굽기 — "apose" 는 «지금 자세»를 그대로 굽는다(복원 0). */
        const r = bakeBodyVerts(glb, root, "apose");
        const v = r.verts;
        let ymin = Infinity, ymax = -Infinity;
        for (let j = 1; j < v.length; j += 3) { if (v[j] < ymin) ymin = v[j]; if (v[j] > ymax) ymax = v[j]; }
        const 팔축_후 = arms.map((a) => ({ name: a.name, dir: findArmDirection(a).toArray() }));
        const rowsOrigin = arms.map((a) => {
          const p = new THREE.Vector3(); a.getWorldPosition(p);
          return { name: a.name, 피벗: [p.x, p.y, p.z], 중심선투영: [0, p.y, p.z], 방향: findArmDirection(a).toArray() };
        });
        const pick = (want: "Left" | "Right") => rowsOrigin.find((x) => x.name.includes(want));
        const bodyMeta = { what: "v4-40 §1-② A포즈 그리드 몸(브라우저 하네스)", body: id, deg: DEG,
          n: v.length / 3, bakeResult: { bitEqual: r.bitEqual, maxDeltaM: r.maxDeltaM, pose: r.pose, skinned: r.skinned },
          팔축_후, 높이m: ymax - ymin, ymin, ymax, 전진프레임: k, 굽기잔차: resid,
          목표: { chest: b.chest, height: b.height, shoulder: b.shoulder, arm: FIXED.armLength, leg: FIXED.legLength },
          문턱: { 상한프레임: CAP_FRAMES, POSE_SETTLE_EPS } };
        const originMeta = { what: "v4-40 §1-② 어깨 피벗(대역 원점 C) — 뼈에서 읽는다", body: id, deg: DEG,
          "C 규약": "넘기는 값 = 중심선투영(x=0) — v4-26 §0-4ㄱ 과 같은 규약",
          left: pick("Left"), right: pick("Right") };
        const bin = new Uint8Array(v.buffer as ArrayBuffer);
        const sha = dry ? await sha256Hex(v.buffer as ArrayBuffer) : await send(`l3ap-body-${id}-a${DEG}.bin`, bin);
        if (!dry) {
          const enc = new TextEncoder();
          await send(`l3ap-body-${id}-a${DEG}.json`, enc.encode(JSON.stringify({ ...bodyMeta, sha256: sha }, null, 1)));
          await send(`l3ap-origin-${id}-a${DEG}.json`, enc.encode(JSON.stringify(originMeta, null, 1)));
        }
        out.push({ id, 결과: "통과", 전진프레임: k, 굽기잔차: resid, 높이m: ymax - ymin, sha256: sha,
                   반출: dry ? "드라이런(0)" : "3", 잔차궤적: trail.join(" ") });
      } catch (e) {
        out.push({ id, 결과: "던짐", 전진프레임: k, 굽기잔차: resid, 높이m: NaN, sha256: "", 반출: "0",
                   잔차궤적: trail.join(" "), 사유: (e as Error).message });
      }
      setRows([...out]);
      await new Promise((res) => setTimeout(res, 700));    // v3-83 과 같은 간격
    }
    const rec = { 메타: `v4-40 §1-② A포즈 그리드 몸 ${list.length}칸 · deg ${DEG}` +
      `${dry ? " · 드라이런(반출 0)" : ""}${only ? ` · 한 칸(${only})` : ""}` +
      ` · 게이트 ㉮상한${CAP_FRAMES} · ㉯잔차≤${POSE_SETTLE_EPS} · 문턱은 전부 인용(새 수 0)`, 행: out };
    (window as unknown as Record<string, unknown>).__v4aposeIndex = rec;
    if (!dry) {
      try { await send(`l3ap-grid-index-a${DEG}.json`, new TextEncoder().encode(JSON.stringify(rec, null, 1))); }
      catch (e) { console.log(`[v4-40] 색인 반출 실패 — ${(e as Error).message}`); }
    }
    setNow(`완료 — 통과 ${out.filter((x) => x.결과 === "통과").length}/${list.length}`);
    setBusy(false);
  }, []);

  const 통과 = rows.filter((x) => x.결과 === "통과").length;
  return (
    <div className="rounded border p-2 text-xs">
      <div className="flex items-center gap-2">
        <button className="rounded bg-black px-2 py-1 text-white disabled:opacity-40" onClick={run} disabled={busy}>
          A포즈 그리드 몸 굽기(27칸)
        </button>
        <span>{now || "대기 — 먼저 수신기를 띄운다"}</span>
        <span>{rows.length ? `· 통과 ${통과}/${rows.length}` : ""}</span>
      </div>
      {rows.length > 0 && (
        <table className="mt-2 w-full">
          <thead><tr><th className="text-left">칸</th><th>결과</th><th>전진</th><th>잔차</th><th>높이 m</th><th>반출</th><th className="text-left">잔차 궤적</th><th className="text-left">사유</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={r.결과 === "통과" ? "" : "text-red-600"}>
                <td>{r.id}</td><td className="text-center">{r.결과}</td><td className="text-center">{r.전진프레임}</td>
                <td className="text-center">{r.굽기잔차.toExponential(2)}</td>
                <td className="text-center">{Number.isFinite(r.높이m) ? r.높이m.toFixed(4) : "—"}</td>
                <td className="text-center">{r.반출}</td><td>{r.잔차궤적 ?? ""}</td><td>{r.사유 ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
