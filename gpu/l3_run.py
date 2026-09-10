"""v4-08 §1-② — **층3(관측량)의 v4 쪽 실행기**. 수렴 판정을 «보지 않고» 프레임 수만 맞춘다.

층2 는 v4-08 §0 에서 폐기됐다(최종 정점 좌표가 well-posed 하지 않다 · 함정 41) ⟹
이 실행기는 **수렴에서 멈추지 않는다**. v3 정본 blob 이 만들어진 프레임 수(`FRAMES`, 기본 180)
만큼 «그대로» 돌리고 **최종 위치**를 낸다. 판정은 그 위치가 만드는 **핏 리포트 5행**으로 한다.

물리는 `engine/full.py` 를 **그대로** 부른다(커널 diff 0). 이 파일에 물리 식은 0줄이다.

산출 — `l3-<cell>-<cons>-<fp>-f<FRAMES>.bin` = **float64 3n «순수 나열»**(헤더 0)
        ⟹ `scripts/v4FitReport.ts` 의 `POS=` 로 그대로 들어간다.

진입: `py gpu/l3_run.py [cons] [frames] [fp]`
  cons   = all(기본) | ipseam | bendseam
  frames = 180(기본 · v3 정본 blob 의 `frame`)
  fp     = f32(기본) | f64
"""
import json
import sys
import time
from pathlib import Path

import numpy as np
import taichi as ti

sys.path.insert(0, str(Path(__file__).resolve().parent))
from oracle import load  # noqa: E402
from engine import full as F, collide as CO, seam as SE  # noqa: E402

CELL = "c100-h170-s45_M"
BODY = "c100-h170-s45"
CONS = sys.argv[1] if len(sys.argv) > 1 else "all"
FRAMES = int(sys.argv[2]) if len(sys.argv) > 2 else 180
FPN = sys.argv[3] if len(sys.argv) > 3 else "f32"
fp, npfp = (ti.f64, np.float64) if FPN == "f64" else (ti.f32, np.float32)
FLAGS = {"all": dict(use_ip=1, use_bd=1, use_sm=1, use_col=1),
         "ipseam": dict(use_ip=1, use_bd=0, use_sm=1, use_col=1),
         "bendseam": dict(use_ip=0, use_bd=1, use_sm=1, use_col=1)}[CONS]

hs, invm, ip_idx, ip_par = load.scene(CELL)
hb, bd_idx, bd_par = load.scene_bend(CELL)
hm, sm_idx, sm_rest = SE.load_seam(load.EXPORT / f"scene-seam-{CELL}.bin")
sh, sdata = CO.load_sdf(load.EXPORT / f"sdf-{BODY}.bin")
n = hs["n"]
head, st, _ = load.cloth(CELL)                       # 정착 blob — 위치 3n + 속도 3n
pos0 = st[: n * 3].reshape(n, 3)
vel0 = st[n * 3:].reshape(n, 3)

t_init = time.perf_counter()
ti.init(arch=ti.cuda, default_fp=fp)
arch = str(ti.lang.impl.current_cfg().arch)
assert ti.lang.impl.current_cfg().arch == ti.cuda, "조용한 arch 폴백(v4-01 함정 1)"
fu = F.Full(pos0.astype(npfp), vel0.astype(npfp), invm.astype(npfp),
            ip_idx, ip_par.astype(npfp), hs["k"], bd_idx, bd_par.astype(npfp), hb["ke"],
            sm_idx, sm_rest.astype(npfp), sh, sdata, sh["THICK"], sh["MU"], fp=fp)
init_s = time.perf_counter() - t_init

DT, G, DAMP, SUB = 1 / 60, 9.81, 6.0, hs["substeps"]
N_WIN = 10                                            # dressRun.ts:N_WIN — 인쇄 간격일 뿐 «판정 0»
ref = fu.pos.to_numpy().astype(np.float64)
out = load.EXPORT / f"l3-{CELL}-{CONS}-{FPN}-f{FRAMES}"

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
pos.tofile(str(out) + ".bin")                         # 헤더 0 · float64 3n
meta = {"cell": CELL, "cons": CONS, "fp": FPN, "n": n, "substeps": SUB,
        "frames": frame, "N_WIN": N_WIN, "blobFrame": int(head.get("frame", -1)),
        "sec": el, "secPerFrame": el / max(frame, 1),
        "secPerFrameVertex": el / max(frame, 1) / n,
        "initSec": init_s, "arch": arch, "lastNet": trail[-1][1], "trail": trail}
json.dump(meta, open(str(out) + ".json", "w"), indent=1)
print(f"[층3 {CONS} {FPN}] 프레임 {frame} · {el:.1f}s ({el / max(frame, 1):.3f} s/프레임) · "
      f"arch {arch} · 초기화 {init_s:.1f}s · 마지막 창 순변위 {trail[-1][1]:.6e}")
print(f"  → {out}.bin  (float64 {n}×3 · 헤더 0)")
