"""v4-16 §1-②ㄷ — **색 분할 해소판 실행기**. `l3br_run.py`(v4-15)와 «같은 계기»이되
세우는 클래스만 `FullSCColored` 다(해소 커널 하나가 바뀐다 · 나머지는 diff 0).

같은 조건(§0-5ㄷ) — 프레임 수는 **그 칸 정본 blob 헤더의 `frame`** 에서 읽는다(칸마다 다르다) ·
`tol` 은 v4-13/14 와 같은 자리에서 읽는다 · **정착 도달과 헤더 프레임 수 중 먼저 오는 쪽**에서 멈춘다 ·
N_WIN 10 · substeps 는 그 칸 장면의 값 · 초기 상태 = 그 칸 blob 의 f64 원본(f32 판은 캐스팅).

★ 삼각형 배열은 **그 칸 장면의 `ip_idx`** 를 쓴다 — 기본몸 M 에서 v3 가 낸 `tris` 와
  **바이트 동일**임을 확인했다(`makeInplane` 이 `tris` 를 순서대로 도므로 구조적으로 같다).
★ 예산(§0-5ㅅ) — 한 칸이 **30분**을 넘으면 정지하고 그 사실과 궤적을 남긴다.
진입: `py gpu/l3rp_run.py <cuda|x64> <f64|f32> <cell> [rounds]`
"""
import json
import struct
import sys
import time
from pathlib import Path

import numpy as np
import taichi as ti

sys.path.insert(0, str(Path(__file__).resolve().parent))
from oracle import load  # noqa: E402
from engine import full_sc_col as FS, collide as CO, seam as SE  # noqa: E402

ARCH = sys.argv[1]
FPN = sys.argv[2]
CELL = sys.argv[3]
ROUNDS = int(sys.argv[4]) if len(sys.argv) > 4 else 64
BODY = CELL.rsplit("_", 1)[0]
ARCH_T = {"cuda": ti.cuda, "x64": ti.x64, "arm64": ti.arm64}[ARCH]
fp, npfp = ({"f32": (ti.f32, np.float32), "f64": (ti.f64, np.float64)})[FPN]
FLAGS = dict(use_ip=1, use_bd=1, use_sm=1, use_col=1)
BUDGET_S = 30 * 60                                     # §0-5ㅅ — 한 칸 30분

TOL = float(json.load(open(load.EXPORT / "cellconv7-c100-h170-s45_M-all-e0-x0.json",
                           encoding="utf-8"))["tol"])
blob = Path("public/v3diag/v3-77") / f"settled-{CELL}.bin"
raw = blob.read_bytes()
hl = struct.unpack("<I", raw[:4])[0]
BH = json.loads(raw[4:4 + hl].decode("utf-8"))
FRAMES = int(BH["frame"])

hs, invm, ip_idx, ip_par = load.scene(CELL)
hb, bd_idx, bd_par = load.scene_bend(CELL)
hm, sm_idx, sm_rest = SE.load_seam(load.EXPORT / f"scene-seam-{CELL}.bin")
sh, sdata = CO.load_sdf(load.EXPORT / f"sdf-{BODY}.bin")
n = hs["n"]
assert n == BH["n"], f"정점 수가 다르다 — blob {BH['n']} ≠ 조립 {n}(옛 조립 칸)"
head, st, _ = load.cloth(CELL)
pos0 = st[: n * 3].reshape(n, 3).astype(npfp)
vel0 = st[n * 3:].reshape(n, 3).astype(npfp)
blob_pos = st[: n * 3].reshape(n, 3).astype(np.float64)     # 대조 기준(정본 blob 위치)
tris = np.ascontiguousarray(ip_idx.astype(np.int32))

t_init = time.perf_counter()
ti.init(arch=ARCH_T, default_fp=fp)
arch = str(ti.lang.impl.current_cfg().arch)
assert ti.lang.impl.current_cfg().arch == ARCH_T, f"조용한 arch 폴백(v4-01 함정 1) — {arch}"
fu = FS.FullSCColored(pos0, vel0, invm.astype(npfp),
               ip_idx, ip_par.astype(npfp), hs["k"], bd_idx, bd_par.astype(npfp), hb["ke"],
               sm_idx, sm_rest.astype(npfp), sh, sdata, sh["THICK"], sh["MU"], fp=fp, tris=tris, rounds=ROUNDS)
init_s = time.perf_counter() - t_init

DT, G, DAMP, SUB, N_WIN = 1 / 60, 9.81, 6.0, hs["substeps"], 10
out = load.EXPORT / f"l3rp-{CELL}-{FPN}-{ARCH}-r{ROUNDS}"
print(f"[시작 {time.strftime('%H:%M:%S')}] {CELL} · n {n} · T {tris.shape[0]} · substeps {SUB} · "
      f"헤더 프레임 {FRAMES} · tol {TOL:.3e} · arch {arch} · 초기화 {init_s:.1f}s", flush=True)

t_jit = time.perf_counter()
fu.step(1, SUB, DT, G, DAMP, **FLAGS)
jit_s = time.perf_counter() - t_jit
fu.pos.from_numpy(np.ascontiguousarray(pos0, dtype=npfp))
fu.vel.from_numpy(np.ascontiguousarray(vel0, dtype=npfp))
ti.sync()
print(f"  예열 {jit_s:.1f}s · 상태 되감음", flush=True)

ref = fu.pos.to_numpy().astype(np.float64)
trail, wall, frame, deg = [], [], 0, 0
converged, conv_frame, conv_net, last_net, diverged, budget_cut = False, -1, float("nan"), float("nan"), -1, False
scacc = dict(pairs=0, cons=0, applied=0, maxpen=0.0, calls=0)
t0 = time.perf_counter()
while frame < FRAMES:
    w = min(N_WIN, FRAMES - frame)
    _, _, d = fu.step(w, SUB, DT, G, DAMP, **FLAGS)
    deg += d
    for kk in ("pairs", "cons", "applied", "calls"):
        scacc[kk] += fu.sc_stat[kk]
    scacc["maxpen"] = max(scacc["maxpen"], fu.sc_stat["maxpen"])
    p = fu.pos.to_numpy().astype(np.float64)
    frame += w
    if not np.isfinite(p).all():
        diverged = frame
        print(f"  ★ 발산 — f={frame}", flush=True)
        break
    net = float(np.linalg.norm(p - ref, axis=1).max())
    last_net = net
    el = time.perf_counter() - t0
    trail.append((frame, net))
    wall.append((frame, el))
    print(f"  f={frame} net={net:.6e} ({el:.1f}s · {el/frame:.3f} s/프레임)", flush=True)
    ref = p
    if not converged and net <= TOL:
        converged, conv_frame, conv_net = True, frame, net
        print(f"  ★ 정착 도달 f={frame} · {net:.6e} ≤ {TOL:.3e}", flush=True)
        break
    if el > BUDGET_S:
        budget_cut = True
        print(f"  ★ 예산 30분 초과 — f={frame} 에서 정지(§0-5ㅅ)", flush=True)
        break
el = time.perf_counter() - t0
p = fu.pos.to_numpy().astype(np.float64)
p.tofile(str(out) + ".bin")
dv = np.linalg.norm(p - blob_pos, axis=1) * 1000.0
spf = el / max(frame, 1)
meta = {"cell": CELL, "body": BODY, "fp": FPN, "arch": arch, "n": n, "T": int(tris.shape[0]),
        "rounds": ROUNDS, "colorStats": None,
        "substeps": SUB, "frames": frame, "headerFrames": FRAMES, "N_WIN": N_WIN,
        "colors": [fu.ip_colors, fu.bd_colors], "tasksCounted": fu.n_tasks_expected(),
        "sec": el, "secPerFrame": spf, "jitSec": jit_s, "initSec": init_s, "degenerate": deg,
        "tol": TOL, "converged": converged, "convFrame": conv_frame, "convNet": conv_net,
        "lastNet": last_net, "divergedAt": diverged, "budgetCut": budget_cut,
        "finite": bool(np.isfinite(p).all()), "trail": trail, "wall": wall,
        "vs정본blob_mm": {"중앙": float(np.median(dv)), "p99": float(np.percentile(dv, 99)),
                       "최대": float(dv.max()), "maxAt": int(np.argmax(dv)),
                       "최대좌표차": float(np.abs(p - blob_pos).max() * 1000.0)},
        "self": {"서브스텝수": scacc["calls"],
                 "쌍_서브스텝당": scacc["pairs"] / max(scacc["calls"], 1),
                 "접촉_서브스텝당": scacc["cons"] / max(scacc["calls"], 1),
                 "해소_서브스텝당": scacc["applied"] / max(scacc["calls"], 1),
                 "최대침투m": scacc["maxpen"]}}
meta["colorStats"] = fu.sc.color_stats()
json.dump(meta, open(str(out) + ".json", "w", encoding="utf-8"), indent=1, ensure_ascii=False)
print(f"[{CELL} {FPN}] f{frame}/{FRAMES} · {el:.1f}s ({spf:.3f} s/프레임) · "
      f"정착 {'f' + str(conv_frame) if converged else '미도달'} · net {last_net:.6e} · "
      f"vs blob 중앙 {meta['vs정본blob_mm']['중앙']:.6f} · 최대 {meta['vs정본blob_mm']['최대']:.6f} mm")
