"""v4-30 §1-① — **어깨 이탈의 «시점» 계기**(물리 0줄 · 워커 바이트 불변 · 새 스크립트).

왜 새 파일인가 — 회차 프롬프트 §0-2 가 `gpu/bake/worker.py` 를 **diff 0** 으로 못박았다.
이 파일은 워커의 굽기 설정을 **같은 순서로** 세우고(같은 `engine/full_sc` · 같은 램프 식 ·
같은 `cellCap`), **창마다 기하 채널만 «읽어»** 담는다. 물리 식은 한 줄도 없다.

채널(전부 `scripts/v4SlipIdx.ts` 가 씬에서 내보낸 정점 집합으로 잰다 · 손 상수 0):
  목선 링 중심 y · 어깨 봉제선(어깨L∪어깨R) y 중앙 · 옷 전체 y 중심 · 어깨선(Y_TOP) 위 정점 수 ·
  좌/우 소매 y 중앙(③ 대칭 확인용)

진입: `py gpu/bake/slip_probe.py <job.json>`
  job = {name, cell, asm, idx, frames, cellCap, ramp, dumpEvery}
산출 = `gpu/bake/results/<name>/<cell>.bin`(최종 위치 f64) · `<cell>-trail.json`(창별 채널) ·
       `<cell>-f<프레임>.bin`(dumpEvery 마다 · ② 스냅용)
"""
import json
import struct
import sys
import time
from pathlib import Path

import numpy as np
import taichi as ti

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from oracle import load  # noqa: E402
from engine import full_sc as FS, collide as CO, seam as SE  # noqa: E402

JOB = json.load(open(sys.argv[1], encoding="utf-8"))
NAME = JOB["name"]
CELL = JOB["cell"]
OUT = ROOT / "bake" / "results" / NAME
OUT.mkdir(parents=True, exist_ok=True)
fp, npfp = ti.f64, np.float64
ti.init(arch=ti.cuda, default_fp=fp)
assert str(ti.lang.impl.current_cfg().arch) == "Arch.cuda"

TOL = float(json.load(open(load.EXPORT / "cellconv7-c100-h170-s45_M-all-e0-x0.json",
                           encoding="utf-8"))["tol"])
FLAGS = dict(use_ip=1, use_bd=1, use_sm=1, use_col=1)
IDX = json.load(open(load.EXPORT / JOB["idx"], encoding="utf-8"))
NECK = np.asarray(IDX["목선링"], np.int64)
SHOULDER = np.asarray(IDX["어깨봉제"]["어깨L"] + IDX["어깨봉제"]["어깨R"], np.int64)
Y_TOP = float(IDX["Y_TOP(어깨선 높이 · 세계 m)"])
PAN = IDX["패널"]
SLV_R = np.arange(PAN["sleeveR"]["from"], PAN["sleeveR"]["to"])
SLV_L = np.arange(PAN["sleeveL"]["from"], PAN["sleeveL"]["to"])


def channels(p, f):
    """위치 배열에서 «읽기만» 한다 — 계기이지 물리가 아니다."""
    return {"f": f,
            "목선중심y": float(p[NECK, 1].mean()),
            "목선최저y": float(p[NECK, 1].min()),
            "어깨봉제y중앙": float(np.median(p[SHOULDER, 1])),
            "전체y중심": float(p[:, 1].mean()),
            "어깨선위정점": int((p[:, 1] > Y_TOP).sum()),
            "소매R_y중앙": float(np.median(p[SLV_R, 1])),
            "소매L_y중앙": float(np.median(p[SLV_L, 1]))}


def _unpack(path):
    raw = Path(path).read_bytes()
    hl = struct.unpack("<I", raw[:4])[0]
    return json.loads(raw[4:4 + hl].decode("utf-8")), np.frombuffer(raw[4 + hl:], dtype="<f8")


BH, state = _unpack(load.EXPORT / JOB["asm"])
frames = int(JOB.get("frames") or 400)
body = CELL.rsplit("_", 1)[0]
hs, invm, ip_idx, ip_par = load.scene(CELL)
hb, bd_idx, bd_par = load.scene_bend(CELL)
hm, sm_idx, sm_rest = SE.load_seam(load.EXPORT / f"scene-seam-{CELL}.bin")
sh, sdata = CO.load_sdf(load.EXPORT / f"sdf-{body}.bin")
n = hs["n"]
pos0 = state[: n * 3].reshape(n, 3).astype(npfp)
vel0 = state[n * 3:].reshape(n, 3).astype(npfp)
fu = FS.FullSC(pos0, vel0, invm.astype(npfp), ip_idx, ip_par.astype(npfp), hs["k"],
               bd_idx, bd_par.astype(npfp), hb["ke"], sm_idx, sm_rest.astype(npfp),
               sh, sdata, sh["THICK"], sh["MU"], fp=fp,
               tris=np.ascontiguousarray(ip_idx.astype(np.int32)),
               sc_kw=dict(JOB.get("cellCap") or {}))
DT, G, DAMP, SUB, N_WIN = 1 / 60, 9.81, 6.0, hs["substeps"], 10
fu.step(1, SUB, DT, G, DAMP, **FLAGS)                     # 예열(JIT) — 워커와 같은 자리
fu.pos.from_numpy(np.ascontiguousarray(pos0, dtype=npfp))
fu.vel.from_numpy(np.ascontiguousarray(vel0, dtype=npfp))
ti.sync()

ramp = bool(JOB.get("ramp"))
rows = [channels(state[: n * 3].reshape(n, 3).astype(np.float64), 0)]   # f0 = 조립 직후
rampN = None
if ramp:                                                  # 워커 `worker.py` 의 램프 식 «그대로»
    p0 = state[: n * 3].reshape(n, 3).astype(np.float64)
    si = np.asarray(sm_idx, np.int64)
    rest0 = np.linalg.norm(p0[si[:, 0]] - p0[si[:, 1]], axis=1)
    SEPm = 2.0 * float(sh["THICK"])
    rampN = int(np.ceil((rest0.max() - SEPm) / (G * DT * DT)))

dump_every = int(JOB.get("dumpEvery") or 0)
ref = fu.pos.to_numpy().astype(np.float64)
frame, conv, cf, cn = 0, False, -1, float("nan")
t0 = time.perf_counter()
while frame < frames:
    if ramp:
        tt = min(1.0, (frame + 1) / rampN)
        fu.sm_rest.from_numpy(np.ascontiguousarray(rest0 + (SEPm - rest0) * tt, dtype=npfp))
    w = 1 if ramp else min(N_WIN, frames - frame)
    fu.step(w, SUB, DT, G, DAMP, **FLAGS)
    frame += w
    p = fu.pos.to_numpy().astype(np.float64)
    if dump_every and frame % dump_every == 0:
        p.tofile(str(OUT / f"{CELL}-f{frame:03d}.bin"))
    if ramp and frame % N_WIN != 0 and frame < frames:
        rows.append(channels(p, frame))                   # 램프 중에는 «매 프레임» 담는다
        continue
    rows.append(channels(p, frame))
    net = float(np.linalg.norm(p - ref, axis=1).max())
    rows[-1]["창순변위m"] = net
    ref = p
    if not conv and net <= TOL:
        conv, cf, cn = True, frame, net
        break
sec = time.perf_counter() - t0
p = fu.pos.to_numpy().astype(np.float64)
p.tofile(str(OUT / f"{CELL}.bin"))
json.dump({"what": "v4-30 §1-① 이탈 시점 계기(물리 0줄)", "cell": CELL, "asm": JOB["asm"],
           "n": n, "substeps": SUB, "rampN": rampN, "frames": frame, "converged": conv,
           "convFrame": cf, "convNet": cn, "tol": TOL, "sec": sec, "Y_TOP": Y_TOP,
           "rows": rows},
          open(OUT / f"{CELL}-trail.json", "w", encoding="utf-8"), indent=1, ensure_ascii=False)
print(f"[이탈 계기] {CELL} · 정착 f{frame} · convNet {cn} · {sec:.1f}s · 행 {len(rows)}")
