"""v4-14 §1-③ — **전 정의역**(셀프 충돌 포함) 결합 실행기. `engine/full_sc.py` 를 부른다.

v4-13 의 `l3cb2_run.py` 와 «같은 계기»다 — 같은 칸 · 같은 초기 상태 · 같은 창(N_WIN 10) ·
같은 순변위 식 · JIT 을 벽시계 밖으로 빼는 처분까지 같다. **바뀐 것은 셋뿐**:
① 세우는 클래스가 `FullSC`(셀프 충돌 포함) ② 삼각형 배열을 v3 덤프에서 읽는다
③ 멈추는 자리 = **정착 도달 «또는» 정본 blob 헤더의 프레임 수**(§0-5ㅂ · 손 상수 0).

진입: `py gpu/l3full_run.py <cuda|x64|arm64> <f64|f32> [frames_cap] [tag]`
      · `frames_cap` 을 주면 그 수로 «자른다»(§0-5ㅅ 예산 규약 · 준 사실을 산출에 남긴다)
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
from engine import full_sc as FS, collide as CO, seam as SE  # noqa: E402

CELL, BODY = "c100-h170-s45_M", "c100-h170-s45"
ARCH = sys.argv[1] if len(sys.argv) > 1 else "cuda"
FPN = sys.argv[2] if len(sys.argv) > 2 else "f64"
CAP_IN = int(sys.argv[3]) if len(sys.argv) > 3 else 0
TAG = sys.argv[4] if len(sys.argv) > 4 else ""
HOLD = TAG == "hold"      # 보조 채널 — 정착 도달 «후»에도 상한까지 계속 돈다(사실 등재 · 판정 0)
ARCH_T = {"cuda": ti.cuda, "x64": ti.x64, "arm64": ti.arm64}[ARCH]
fp, npfp = ({"f32": (ti.f32, np.float32), "f64": (ti.f64, np.float64)})[FPN]
FLAGS = dict(use_ip=1, use_bd=1, use_sm=1, use_col=1)

TOL_SRC = load.EXPORT / f"cellconv7-{CELL}-all-e0-x0.json"
TOL = float(json.load(open(TOL_SRC, encoding="utf-8"))["tol"])        # v4-13 과 같은 자리에서 읽는다

# 정본 blob 헤더의 «정착 프레임 수»를 읽는다(§0-5ㅂ · 손 상수 0)
blob = Path("public/v3diag/v3-77") / f"settled-{CELL}.bin"
raw = blob.read_bytes()
hl = struct.unpack("<I", raw[:4])[0]
BH = json.loads(raw[4:4 + hl].decode("utf-8"))
FRAMES = int(BH["frame"])
CAP = CAP_IN if CAP_IN > 0 else FRAMES

tris = np.fromfile(load.EXPORT / f"l3sc-v3-{CELL}-tris.bin", dtype=np.int32).reshape(-1, 3)
hs, invm, ip_idx, ip_par = load.scene(CELL)
hb, bd_idx, bd_par = load.scene_bend(CELL)
hm, sm_idx, sm_rest = SE.load_seam(load.EXPORT / f"scene-seam-{CELL}.bin")
sh, sdata = CO.load_sdf(load.EXPORT / f"sdf-{BODY}.bin")
n = hs["n"]
head, st, _ = load.cloth(CELL)
pos0 = st[: n * 3].reshape(n, 3).astype(npfp)
vel0 = st[n * 3:].reshape(n, 3).astype(npfp)

t_init = time.perf_counter()
ti.init(arch=ARCH_T, default_fp=fp)
arch = str(ti.lang.impl.current_cfg().arch)
assert ti.lang.impl.current_cfg().arch == ARCH_T, f"조용한 arch 폴백(v4-01 함정 1) — {arch}"
fu = FS.FullSC(pos0, vel0, invm.astype(npfp),
               ip_idx, ip_par.astype(npfp), hs["k"], bd_idx, bd_par.astype(npfp), hb["ke"],
               sm_idx, sm_rest.astype(npfp), sh, sdata, sh["THICK"], sh["MU"], fp=fp, tris=tris)
init_s = time.perf_counter() - t_init

DT, G, DAMP, SUB, N_WIN = 1 / 60, 9.81, 6.0, hs["substeps"], 10
out = load.EXPORT / f"l3full-{CELL}-sc-{FPN}-{ARCH}{('-' + TAG) if TAG else ''}"
print(f"[시작 {time.strftime('%Y-%m-%d %H:%M:%S')}] 전정의역(셀프충돌 포함) · n {n} · T {tris.shape[0]} · "
      f"substeps {SUB} · 헤더 프레임 {FRAMES} · 상한 {CAP} · tol {TOL:.6e} · "
      f"두께 {fu.thickness} · arch {arch} · 초기화 {init_s:.1f}s", flush=True)

t_jit = time.perf_counter()
fu.step(1, SUB, DT, G, DAMP, **FLAGS)
jit_s = time.perf_counter() - t_jit
sc1 = dict(fu.sc_stat)
fu.pos.from_numpy(np.ascontiguousarray(pos0, dtype=npfp))
fu.vel.from_numpy(np.ascontiguousarray(vel0, dtype=npfp))
ti.sync()
print(f"  예열(JIT 포함 1프레임) {jit_s:.1f}s · 서브스텝당 쌍 {sc1['pairs']/max(sc1['calls'],1):.0f} · "
      f"접촉 {sc1['cons']/max(sc1['calls'],1):.1f} · 해소 {sc1['applied']/max(sc1['calls'],1):.1f} · 상태 되감음",
      flush=True)

ref = fu.pos.to_numpy().astype(np.float64)
trail, wall, frame, deg = [], [], 0, 0
converged, conv_frame, conv_net, last_net, diverged = False, -1, float("nan"), float("nan"), -1
scacc = dict(pairs=0, cons=0, applied=0, maxpen=0.0, calls=0)
t0 = time.perf_counter()
while frame < CAP:
    w = min(N_WIN, CAP - frame)
    _, _, d = fu.step(w, SUB, DT, G, DAMP, **FLAGS)
    deg += d
    for kk in ("pairs", "cons", "applied", "calls"):
        scacc[kk] += fu.sc_stat[kk]
    scacc["maxpen"] = max(scacc["maxpen"], fu.sc_stat["maxpen"])
    p = fu.pos.to_numpy().astype(np.float64)
    frame += w
    if not np.isfinite(p).all():
        diverged = frame
        print(f"  ★ 발산 — f={frame} 에 비유한값", flush=True)
        break
    net = float(np.linalg.norm(p - ref, axis=1).max())
    last_net = net
    el = time.perf_counter() - t0
    trail.append((frame, net))
    wall.append((frame, el))
    print(f"  f={frame} net={net:.6e} ({el:.1f}s · {el/frame:.3f} s/프레임) "
          f"[{time.strftime('%H:%M:%S')}]", flush=True)
    ref = p
    if not converged and net <= TOL:
        converged, conv_frame, conv_net = True, frame, net
        print(f"  ★ 정착 도달 — 프레임 {frame} · 창 순변위 {net:.6e} ≤ tol {TOL:.6e}", flush=True)
        if HOLD:
            print("    (보조 채널 `hold` — 멈추지 않고 상한까지 «머무는지»를 본다 · 판정 0)", flush=True)
        else:
            break
el = time.perf_counter() - t0
p = fu.pos.to_numpy().astype(np.float64)
p.tofile(str(out) + ".bin")
spf = el / max(frame, 1)
meta = {"cell": CELL, "cons": "all+self", "fp": FPN, "arch": arch, "n": n, "T": int(tris.shape[0]),
        "substeps": SUB, "frames": frame, "headerFrames": FRAMES, "cap": CAP, "capCut": CAP_IN > 0,
        "N_WIN": N_WIN, "colors": [fu.ip_colors, fu.bd_colors], "tasksCounted": fu.n_tasks_expected(),
        "sec": el, "secPerFrame": spf, "jitSec": jit_s, "initSec": init_s, "degenerate": deg,
        "tol": TOL, "tolSrc": TOL_SRC.name, "converged": converged, "convFrame": conv_frame,
        "convNet": conv_net, "lastNet": last_net, "divergedAt": diverged,
        "finite": bool(np.isfinite(p).all()), "trail": trail, "wall": wall,
        "self": {"서브스텝수": scacc["calls"],
                 "쌍_서브스텝당": scacc["pairs"] / max(scacc["calls"], 1),
                 "접촉_서브스텝당": scacc["cons"] / max(scacc["calls"], 1),
                 "해소_서브스텝당": scacc["applied"] / max(scacc["calls"], 1),
                 "최대침투m": scacc["maxpen"]}}
json.dump(meta, open(str(out) + ".json", "w", encoding="utf-8"), indent=1, ensure_ascii=False)
print(f"[전정의역 {FPN}×{arch}] 프레임 {frame} · {el:.1f}s ({spf:.3f} s/프레임) · degenerate {deg} · "
      f"정착 {'도달 f' + str(conv_frame) if converged else '미도달'} · 마지막 net {last_net:.6e}")
print(f"  → {out}.json / .bin")
