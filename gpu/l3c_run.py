"""v4-09 §1-③ — **병렬화 소규모 시험 실행기**(늘어남 색 분할판). `full_color.FullColor` 를 부른다.

물리 산술은 `full.py` 의 것을 **상속으로 그대로** 쓴다(재작성 0). 이 실행기는 `l3_run.py` 와
**같은 초기 상태 · 같은 정의역 · 같은 프레임 수**로 돌고, 산출도 같은 모양이다
(float64 3n 순수 나열 ⟹ `scripts/v4FitReport.ts` 의 `POS=` 로 직행).

진입: `py gpu/l3c_run.py [cons] [frames] [fp]`
"""
import json
import sys
import time
from pathlib import Path

import numpy as np
import taichi as ti

sys.path.insert(0, str(Path(__file__).resolve().parent))
from oracle import load  # noqa: E402
from engine import full_color as FC, collide as CO, seam as SE  # noqa: E402

CELL = "c100-h170-s45_M"
BODY = "c100-h170-s45"
CONS = sys.argv[1] if len(sys.argv) > 1 else "all"
FRAMES = int(sys.argv[2]) if len(sys.argv) > 2 else 180
FPN = sys.argv[3] if len(sys.argv) > 3 else "f32"
fp, npfp = (ti.f64, np.float64) if FPN == "f64" else (ti.f32, np.float32)
FLAGS = {"all": dict(use_ip=1, use_bd=1, use_sm=1, use_col=1)}[CONS]

hs, invm, ip_idx, ip_par = load.scene(CELL)
hb, bd_idx, bd_par = load.scene_bend(CELL)
hm, sm_idx, sm_rest = SE.load_seam(load.EXPORT / f"scene-seam-{CELL}.bin")
sh, sdata = CO.load_sdf(load.EXPORT / f"sdf-{BODY}.bin")
n = hs["n"]
head, st, _ = load.cloth(CELL)
pos0 = st[: n * 3].reshape(n, 3)
vel0 = st[n * 3:].reshape(n, 3)

t_init = time.perf_counter()
ti.init(arch=ti.cuda, default_fp=fp)
arch = str(ti.lang.impl.current_cfg().arch)
assert ti.lang.impl.current_cfg().arch == ti.cuda, "조용한 arch 폴백(v4-01 함정 1)"
fu = FC.FullColor(pos0.astype(npfp), vel0.astype(npfp), invm.astype(npfp),
                  ip_idx, ip_par.astype(npfp), hs["k"], bd_idx, bd_par.astype(npfp), hb["ke"],
                  sm_idx, sm_rest.astype(npfp), sh, sdata, sh["THICK"], sh["MU"], fp=fp)
init_s = time.perf_counter() - t_init
print(f"색 수 {fu.ncolors} · 색별 제약 수 {fu.color_sizes} · 합 {sum(fu.color_sizes)}", flush=True)

DT, G, DAMP, SUB, N_WIN = 1 / 60, 9.81, 6.0, hs["substeps"], 10
ref = fu.pos.to_numpy().astype(np.float64)
out = load.EXPORT / f"l3c-{CELL}-{CONS}-{FPN}-f{FRAMES}"

t0 = time.perf_counter()
frame, trail = 0, []
while frame < FRAMES:
    w = min(N_WIN, FRAMES - frame)
    fu.step(w, SUB, DT, G, DAMP, **FLAGS)
    pos = fu.pos.to_numpy().astype(np.float64)
    frame += w
    net = float(np.linalg.norm(pos - ref, axis=1).max())
    trail.append((frame, net))
    print(f"  f={frame} net={net:.6e} ({time.perf_counter() - t0:.0f}s)", flush=True)
    ref = pos
el = time.perf_counter() - t0
pos = fu.pos.to_numpy().astype(np.float64)
pos.tofile(str(out) + ".bin")
json.dump({"cell": CELL, "cons": CONS, "fp": FPN, "n": n, "substeps": SUB, "frames": frame,
           "N_WIN": N_WIN, "ncolors": fu.ncolors, "colorSizes": fu.color_sizes,
           "kernelLaunchesPerSubstep": 1, "topLevelLoopsPerSubstep": 4 + fu.ncolors + 3,
           "sec": el, "secPerFrame": el / max(frame, 1), "initSec": init_s,
           "arch": arch, "trail": trail},
          open(str(out) + ".json", "w", encoding="utf-8"), indent=1, ensure_ascii=False)
print(f"[색분할 {CONS} {FPN}] 프레임 {frame} · {el:.1f}s ({el / max(frame,1):.3f} s/프레임) · "
      f"색 {fu.ncolors} · arch {arch} · 초기화 {init_s:.1f}s")
print(f"  → {out}.bin")
