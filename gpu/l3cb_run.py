"""v4-10 §1-④ — **늘어남+굽힘 색 분할판 실행기**(60프레임). `full_color2.FullColor2` 를 부른다.

`l3_dom.py`(직렬)와 **같은 초기 상태 · 같은 정의역 · 같은 창 정의**로 돈다. 산출도 같은 모양이다
(float64 3n 순수 나열 ⟹ `scripts/v4FitReport.ts` 의 `POS=` 로 직행).

진입: `py gpu/l3cb_run.py [cons] [frames] [fp]`
"""
import json
import sys
import time
from pathlib import Path

import numpy as np
import taichi as ti

sys.path.insert(0, str(Path(__file__).resolve().parent))
from oracle import load  # noqa: E402
from engine import full_color2 as FC2, collide as CO, seam as SE  # noqa: E402

CELL = "c100-h170-s45_M"
BODY = "c100-h170-s45"
CONS = sys.argv[1] if len(sys.argv) > 1 else "all"
FRAMES = int(sys.argv[2]) if len(sys.argv) > 2 else 60
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
fu = FC2.FullColor2(pos0.astype(npfp), vel0.astype(npfp), invm.astype(npfp),
                    ip_idx, ip_par.astype(npfp), hs["k"], bd_idx, bd_par.astype(npfp), hb["ke"],
                    sm_idx, sm_rest.astype(npfp), sh, sdata, sh["THICK"], sh["MU"], fp=fp)
init_s = time.perf_counter() - t_init
tops = 4 + fu.ip_colors + fu.bd_colors + 3
stamp = time.strftime("%Y-%m-%d %H:%M:%S")
print("[시작 " + stamp + "] 색분할2 " + CONS + " " + FPN
      + " · 늘어남 " + str(fu.ip_colors) + "색 " + str(fu.ip_sizes)
      + " · 굽힘 " + str(fu.bd_colors) + "색 " + str(fu.bd_sizes)
      + " · 최상위 루프/서브스텝 " + str(tops) + " · arch " + arch
      + " · 초기화 " + format(init_s, ".1f") + "s", flush=True)

DT, G, DAMP, SUB, N_WIN = 1 / 60, 9.81, 6.0, hs["substeps"], 10
ref = fu.pos.to_numpy().astype(np.float64)
out = load.EXPORT / ("l3cb-" + CELL + "-" + CONS + "-" + FPN + "-f" + str(FRAMES))

t0 = time.perf_counter()
frame, trail, wall = 0, [], []
while frame < FRAMES:
    w = min(N_WIN, FRAMES - frame)
    fu.step(w, SUB, DT, G, DAMP, **FLAGS)
    pos = fu.pos.to_numpy().astype(np.float64)
    frame += w
    net = float(np.linalg.norm(pos - ref, axis=1).max())
    el = time.perf_counter() - t0
    trail.append((frame, net))
    wall.append((frame, el))
    print("  f=" + str(frame) + " net=" + format(net, ".6e")
          + " (" + format(el, ".0f") + "s · " + format(el / frame, ".3f") + " s/프레임) ["
          + time.strftime("%H:%M:%S") + "]", flush=True)
    ref = pos
el = time.perf_counter() - t0
pos = fu.pos.to_numpy().astype(np.float64)
pos.tofile(str(out) + ".bin")
json.dump({"cell": CELL, "cons": CONS, "fp": FPN, "n": n, "substeps": SUB, "frames": frame,
           "N_WIN": N_WIN, "ipColors": fu.ip_colors, "ipSizes": fu.ip_sizes,
           "bdColors": fu.bd_colors, "bdSizes": fu.bd_sizes,
           "topLevelLoopsPerSubstep": tops,
           "sec": el, "secPerFrame": el / max(frame, 1), "initSec": init_s,
           "arch": arch, "trail": trail, "wall": wall},
          open(str(out) + ".json", "w", encoding="utf-8"), indent=1, ensure_ascii=False)
print("[색분할2 " + CONS + " " + FPN + "] 프레임 " + str(frame) + " · " + format(el, ".1f") + "s ("
      + format(el / max(frame, 1), ".3f") + " s/프레임) · 늘어남 " + str(fu.ip_colors) + "색 · 굽힘 "
      + str(fu.bd_colors) + "색 · arch " + arch)
print("  → " + str(out) + ".bin")
