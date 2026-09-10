"""v4-12 §1-① — **f64 결착**. `engine/full.py` 를 «그대로» 부른다(물리 식 0줄 · 바이트 불변).

같은 칸 · 같은 초기 상태(정착 blob 의 **f64 원본** — 캐스팅 0) · 같은 제약 집합(`all`) 로
v4 를 **f64** 로 돌려 창 순변위 궤적을 낸다. 판정 갈래·「감소 추세」의 정의는 §0-3·§0-4ㄱ.

★ arch 는 **인자로 받고 실측을 그대로 인쇄**한다(`current_cfg().arch` · 함정 1).
  CUDA f64 가 느려 x64 로 떨어지면 그 사실이 그대로 등재된다(§0-4ㄴ).
진입: `py gpu/l3f64_run.py [arch=cuda|x64] [frames] [n_win]`
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

CELL, BODY = "c100-h170-s45_M", "c100-h170-s45"
ARCH = sys.argv[1] if len(sys.argv) > 1 else "cuda"
FRAMES = int(sys.argv[2]) if len(sys.argv) > 2 else 60
N_WIN = int(sys.argv[3]) if len(sys.argv) > 3 else 10
FPN = "f64"
fp, npfp = ti.f64, np.float64
FLAGS = dict(use_ip=1, use_bd=1, use_sm=1, use_col=1)
ARCH_T = {"cuda": ti.cuda, "x64": ti.x64}[ARCH]

hs, invm, ip_idx, ip_par = load.scene(CELL)
hb, bd_idx, bd_par = load.scene_bend(CELL)
hm, sm_idx, sm_rest = SE.load_seam(load.EXPORT / f"scene-seam-{CELL}.bin")
sh, sdata = CO.load_sdf(load.EXPORT / f"sdf-{BODY}.bin")
n = hs["n"]
head, st, _ = load.cloth(CELL)
pos0 = st[: n * 3].reshape(n, 3).astype(npfp)      # 정착 blob 의 f64 «원본»
vel0 = st[n * 3:].reshape(n, 3).astype(npfp)

t_init = time.perf_counter()
ti.init(arch=ARCH_T, default_fp=fp)
arch = str(ti.lang.impl.current_cfg().arch)
assert ti.lang.impl.current_cfg().arch == ARCH_T, f"조용한 arch 폴백(v4-01 함정 1) — {arch}"
fu = F.Full(pos0, vel0, invm.astype(npfp),
            ip_idx, ip_par.astype(npfp), hs["k"], bd_idx, bd_par.astype(npfp), hb["ke"],
            sm_idx, sm_rest.astype(npfp), sh, sdata, sh["THICK"], sh["MU"], fp=fp)
init_s = time.perf_counter() - t_init

DT, G, DAMP, SUB = 1 / 60, 9.81, 6.0, hs["substeps"]
out = load.EXPORT / f"l3f64-{CELL}-all-{FPN}-{ARCH}-f{FRAMES}"
print(f"[시작 {time.strftime('%Y-%m-%d %H:%M:%S')}] f64 · n {n} · substeps {SUB} · "
      f"프레임 {FRAMES} · 창 {N_WIN} · arch {arch} · 초기화 {init_s:.1f}s", flush=True)

ref = fu.pos.to_numpy().astype(np.float64)
trail, wall, frame, deg = [], [], 0, 0
t0 = time.perf_counter()
while frame < FRAMES:
    w = min(N_WIN, FRAMES - frame)
    _, _, d = fu.step(w, SUB, DT, G, DAMP, **FLAGS)
    deg += d
    p = fu.pos.to_numpy().astype(np.float64)
    frame += w
    net = float(np.linalg.norm(p - ref, axis=1).max())
    el = time.perf_counter() - t0
    trail.append((frame, net))
    wall.append((frame, el))
    print(f"  f={frame} net={net:.6e} ({el:.0f}s · {el/frame:.3f} s/프레임) "
          f"[{time.strftime('%H:%M:%S')}]", flush=True)
    ref = p
el = time.perf_counter() - t0
p = fu.pos.to_numpy().astype(np.float64)
p.tofile(str(out) + ".bin")
meta = {"cell": CELL, "cons": "all", "fp": FPN, "arch": arch, "archReq": ARCH, "n": n,
        "substeps": SUB, "frames": frame, "N_WIN": N_WIN, "sec": el,
        "secPerFrame": el / max(frame, 1), "initSec": init_s, "degenerate": deg,
        "trail": trail, "wall": wall}
json.dump(meta, open(str(out) + ".json", "w", encoding="utf-8"), indent=1, ensure_ascii=False)
print(f"[f64 {arch}] 프레임 {frame} · {el:.1f}s ({el/max(frame,1):.3f} s/프레임) · degenerate {deg}")
print(f"  → {out}.json / .bin")
