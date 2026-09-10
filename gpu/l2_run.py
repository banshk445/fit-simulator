"""v4-06 §1-③ — **층2(수렴 도달)의 v4 쪽 실행기**. 궤적을 보지 않고 «도착점»만 낸다.

수렴 판정은 v3 인용(새 수 0) — `dressRun.ts:N_WIN` = 10 · `s4Gate.ts:settleNetM` = `TOL_SELF` = 1e-4 m ·
창 순변위 = `max_v |pos_v − ref_v|`(`runFrames` 의 식).

진입: `py gpu/l2_run.py <cons> <cap> [fp] [extra]`
  cons  = all | ipseam | bendseam   (몸 충돌·중력은 «공통» · v4-06 §0-4)
  fp    = f32(기본) | f64
  extra = 수렴 «후» 더 돌릴 프레임 수(v4-07 §1-② 계기 규칙의 P) — 기본 0
★ v4-07 §1-③ — 연장 P 는 **v3 쪽과 «같은 규약»**으로 돈다(수렴 선언 후 P 프레임).
  대조는 **연장 끝 상태**로 한다(궤적 0 · 중간 스냅은 남기되 대조 채널이 아니다).
"""
import json
import sys
import time
from pathlib import Path

import numpy as np
import taichi as ti

sys.path.insert(0, str(Path(__file__).resolve().parent))
from oracle import load  # noqa: E402
from engine import full as F, collide as CO, seam as SE, converge as C  # noqa: E402

CELL = "c100-h170-s45_M"
BODY = "c100-h170-s45"
CONS = sys.argv[1] if len(sys.argv) > 1 else "all"
CAP = int(sys.argv[2]) if len(sys.argv) > 2 else 300
FPN = sys.argv[3] if len(sys.argv) > 3 else "f32"
EXTRA = int(sys.argv[4]) if len(sys.argv) > 4 else 0
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

ti.init(arch=ti.cuda, default_fp=fp)
assert ti.lang.impl.current_cfg().arch == ti.cuda, "조용한 arch 폴백(v4-01 함정 1)"
fu = F.Full(pos0.astype(npfp), vel0.astype(npfp), invm.astype(npfp),
            ip_idx, ip_par.astype(npfp), hs["k"], bd_idx, bd_par.astype(npfp), hb["ke"],
            sm_idx, sm_rest.astype(npfp), sh, sdata, sh["THICK"], sh["MU"], fp=fp)

N_WIN, TOL = 10, 1e-4                                # dressRun.ts:N_WIN · s4Gate.ts:settleNetM
DT, G, DAMP, SUB = 1 / 60, 9.81, 6.0, hs["substeps"]
ref = fu.pos.to_numpy().astype(np.float64)
frame, net, converged, trail = 0, float("inf"), False, []
conv_frame, conv_net, snaps = -1, float("nan"), {}
SNAPS = [0, 50, 100, 200, 400]
out = load.EXPORT / f"l2-{CELL}-{CONS}-{FPN}"


def snap(off, fr, nt):
    pos_ = fu.pos.to_numpy().astype(np.float64)
    pos_.tofile(f"{out}-x{off}.bin")
    snaps[off] = {"frame": fr, "net": nt}
    print(f"  스냅 +{off} · 프레임 {fr} · net {nt:.6e}", flush=True)


t0 = time.perf_counter()
while frame < CAP:
    fu.step(N_WIN, SUB, DT, G, DAMP, **FLAGS)
    pos = fu.pos.to_numpy().astype(np.float64)
    frame += N_WIN
    net = float(np.linalg.norm(pos - ref, axis=1).max())
    trail.append((frame, net))
    print(f"  f={frame} net={net:.6e} ({time.perf_counter() - t0:.0f}s)", flush=True)
    if not converged and net <= TOL:
        converged, conv_frame, conv_net = True, frame, net
        if 0 in SNAPS:
            snap(0, frame, net)
        if EXTRA <= 0:
            break
    elif converged:
        off = frame - conv_frame
        if off in SNAPS:
            snap(off, frame, net)
        if off >= EXTRA:
            break
    ref = pos
el = time.perf_counter() - t0
pos = fu.pos.to_numpy().astype(np.float64)
pos.astype(np.float64).tofile(str(out) + ".bin")
json.dump({"cell": CELL, "cons": CONS, "fp": FPN, "n": n, "substeps": SUB,
           "N_WIN": N_WIN, "tol": TOL, "frames": frame, "converged": converged,
           "convFrame": conv_frame, "convNet": conv_net, "extra": EXTRA, "snaps": snaps,
           "net": net, "cap": CAP, "sec": el, "secPerFrame": el / max(frame, 1),
           "arch": str(ti.lang.impl.current_cfg().arch), "trail": trail},
          open(str(out) + ".json", "w"), indent=1)
print(f"[{CONS} {FPN}] 수렴 {converged} · 수렴프레임 {conv_frame} · 최종프레임 {frame} · "
      f"net {net:.6e} · {el:.0f}s ({el / max(frame, 1):.2f} s/프레임)")
