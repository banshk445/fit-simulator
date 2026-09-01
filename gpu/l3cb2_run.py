"""v4-13 §1-①② — **f64 × 병렬 «결합»** 실행기. `engine/full_par.py` 를 그대로 부른다.

v4-12 의 `l3par_run.py`(f32·CUDA 고정)와 **같은 계기**다 — 같은 칸 · 같은 초기 상태 ·
같은 제약 집합 `all` · 같은 창(N_WIN 10) · 같은 순변위 식 · JIT 을 벽시계 밖으로 빼는 처분까지 같다.
**바뀐 것은 둘뿐**: ① `arch` 와 `default_fp` 를 «인자»로 받는다 ② `TOL` 이 주어지면
창 순변위가 그 값 이하가 될 때까지 돌린다(§1-② 정착 자리 확보 · 상한 = FRAMES).

★ 물리 식 0줄 — `engine/` 은 한 바이트도 바뀌지 않는다(§0-3). 이 파일이 고르는 것은 **dtype·arch** 뿐이다.
★ 수렴 문턱은 **손으로 적지 않는다**(§0-5ㄹ) — v3 산출물 헤더의 `tol` 필드에서 «읽는다».
  그 값은 `src/v3/s4Gate.ts:settleNetM`(= `TOL_SELF`)이 v3 실행 시점에 새긴 것이다.

진입: `py gpu/l3cb2_run.py <cuda|x64> <f32|f64> [frames] [conv]`
      · `conv` 를 주면 문턱 도달 시 정지(상한 frames) · 안 주면 frames 를 끝까지 돈다.
"""
import json
import sys
import time
from pathlib import Path

import numpy as np
import taichi as ti

sys.path.insert(0, str(Path(__file__).resolve().parent))
from oracle import load  # noqa: E402
from engine import full_par as FP, collide as CO, seam as SE  # noqa: E402

CELL, BODY = "c100-h170-s45_M", "c100-h170-s45"
ARCH = sys.argv[1] if len(sys.argv) > 1 else "cuda"
FPN = sys.argv[2] if len(sys.argv) > 2 else "f64"
FRAMES = int(sys.argv[3]) if len(sys.argv) > 3 else 60
CONV = len(sys.argv) > 4 and sys.argv[4] == "conv"
ARCH_T = {"cuda": ti.cuda, "x64": ti.x64}[ARCH]
fp, npfp = ({"f32": (ti.f32, np.float32), "f64": (ti.f64, np.float64)})[FPN]
FLAGS = dict(use_ip=1, use_bd=1, use_sm=1, use_col=1)

# 수렴 문턱 — v3 산출물 헤더에서 «읽는다»(손 상수 0 · §0-5ㄹ)
TOL_SRC = load.EXPORT / f"cellconv7-{CELL}-all-e0-x0.json"
TOL = float(json.load(open(TOL_SRC, encoding="utf-8"))["tol"])

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
fu = FP.FullPar(pos0, vel0, invm.astype(npfp),
                ip_idx, ip_par.astype(npfp), hs["k"], bd_idx, bd_par.astype(npfp), hb["ke"],
                sm_idx, sm_rest.astype(npfp), sh, sdata, sh["THICK"], sh["MU"], fp=fp)
init_s = time.perf_counter() - t_init

DT, G, DAMP, SUB, N_WIN = 1 / 60, 9.81, 6.0, hs["substeps"], 10
tag = "conv" if CONV else f"f{FRAMES}"
out = load.EXPORT / f"l3cb2-{CELL}-all-{FPN}-{ARCH}-{tag}"
print(f"[시작 {time.strftime('%Y-%m-%d %H:%M:%S')}] 병렬×{FPN}×{arch} · n {n} · substeps {SUB} · "
      f"상한 {FRAMES}프레임 · 색 {fu.ip_colors}/{fu.bd_colors} · "
      f"코드에서 센 태스크 {fu.n_tasks_expected()} · 수렴모드 {CONV} · tol {TOL:.6e}(읽음: {TOL_SRC.name}) · "
      f"초기화 {init_s:.1f}s", flush=True)

# JIT 은 벽시계 «밖» — 1프레임 예열 후 상태를 되감는다(v4-12 l3par_run 과 같은 처분)
t_jit = time.perf_counter()
fu.step(1, SUB, DT, G, DAMP, **FLAGS)
jit_s = time.perf_counter() - t_jit
fu.pos.from_numpy(np.ascontiguousarray(pos0, dtype=npfp))
fu.vel.from_numpy(np.ascontiguousarray(vel0, dtype=npfp))
ti.sync()
print(f"  예열(JIT 포함 1프레임) {jit_s:.1f}s · 상태 되감음", flush=True)

ref = fu.pos.to_numpy().astype(np.float64)
trail, wall, frame, deg = [], [], 0, 0
converged, conv_frame, conv_net, last_net = False, -1, float("nan"), float("nan")
diverged = -1
t0 = time.perf_counter()
while frame < FRAMES:
    w = min(N_WIN, FRAMES - frame)
    _, _, d = fu.step(w, SUB, DT, G, DAMP, **FLAGS)
    deg += d
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
    if CONV and not converged and net <= TOL:
        converged, conv_frame, conv_net = True, frame, net
        print(f"  ★ 수렴 선언 — 프레임 {frame} · 창 순변위 {net:.6e} ≤ tol {TOL:.6e}", flush=True)
        break
el = time.perf_counter() - t0
p = fu.pos.to_numpy().astype(np.float64)
p.tofile(str(out) + ".bin")
SERIAL_REF = 12.690        # v4-10 직렬 s/프레임(v4-12 §0-4ㅁ 가 지정한 분모 · 그대로 인용)
spf = el / max(frame, 1)
meta = {"cell": CELL, "cons": "all", "fp": FPN, "arch": arch, "archReq": ARCH, "n": n,
        "substeps": SUB, "frames": frame, "cap": FRAMES, "N_WIN": N_WIN,
        "colors": [fu.ip_colors, fu.bd_colors], "tasksCounted": fu.n_tasks_expected(),
        "sec": el, "secPerFrame": spf, "jitSec": jit_s, "initSec": init_s, "degenerate": deg,
        "serialRefSecPerFrame": SERIAL_REF, "speedup": SERIAL_REF / spf,
        "convMode": CONV, "tol": TOL, "tolSrc": TOL_SRC.name,
        "converged": converged, "convFrame": conv_frame, "convNet": conv_net,
        "lastNet": last_net, "divergedAt": diverged,
        "finite": bool(np.isfinite(p).all()), "trail": trail, "wall": wall}
json.dump(meta, open(str(out) + ".json", "w", encoding="utf-8"), indent=1, ensure_ascii=False)
print(f"[결합 {FPN}×{arch}] 프레임 {frame} · {el:.1f}s ({spf:.3f} s/프레임) · "
      f"직렬 {SERIAL_REF} 대비 {SERIAL_REF/spf:.2f}배 · degenerate {deg} · "
      f"수렴 {'도달 f' + str(conv_frame) if converged else '미도달'} · 마지막 net {last_net:.6e}")
print(f"  → {out}.json / .bin")
