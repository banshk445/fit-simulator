"""v4-12 §1-③ㄴ — **«진짜» 병렬 커널 60프레임**. `engine/full_par.py`(신설)를 부른다.

`l3_dom.py`(v4-10 직렬 실행기)와 **같은 계기**다 — 같은 칸 · 같은 초기 상태 · 같은 제약 집합 `all` ·
같은 창(N_WIN 10) · 같은 순변위 식. 바뀐 것은 **어느 클래스를 세우는가** 하나뿐이다.
★ 색 순서가 v3 배열 순서와 달라 직렬판과 «갈릴 수 있다»(v4-10 §0 등재) ⟹ 이 실행기는 **판정 0** ·
  궤적과 위치를 «값으로만» 낸다(리포트 5행은 `scripts/v4FitReport.ts` 가 같은 v3 경로로 낸다).

진입: `py gpu/l3par_run.py [frames]`
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

CELL, BODY, FPN = "c100-h170-s45_M", "c100-h170-s45", "f32"
FRAMES = int(sys.argv[1]) if len(sys.argv) > 1 else 60
fp, npfp = ti.f32, np.float32
FLAGS = dict(use_ip=1, use_bd=1, use_sm=1, use_col=1)

hs, invm, ip_idx, ip_par = load.scene(CELL)
hb, bd_idx, bd_par = load.scene_bend(CELL)
hm, sm_idx, sm_rest = SE.load_seam(load.EXPORT / f"scene-seam-{CELL}.bin")
sh, sdata = CO.load_sdf(load.EXPORT / f"sdf-{BODY}.bin")
n = hs["n"]
head, st, _ = load.cloth(CELL)
pos0 = st[: n * 3].reshape(n, 3).astype(npfp)
vel0 = st[n * 3:].reshape(n, 3).astype(npfp)

t_init = time.perf_counter()
ti.init(arch=ti.cuda, default_fp=fp)
arch = str(ti.lang.impl.current_cfg().arch)
assert ti.lang.impl.current_cfg().arch == ti.cuda, "조용한 arch 폴백(v4-01 함정 1)"
fu = FP.FullPar(pos0, vel0, invm.astype(npfp),
                ip_idx, ip_par.astype(npfp), hs["k"], bd_idx, bd_par.astype(npfp), hb["ke"],
                sm_idx, sm_rest.astype(npfp), sh, sdata, sh["THICK"], sh["MU"], fp=fp)
init_s = time.perf_counter() - t_init

DT, G, DAMP, SUB, N_WIN = 1 / 60, 9.81, 6.0, hs["substeps"], 10
out = load.EXPORT / f"l3par-{CELL}-all-{FPN}-f{FRAMES}"
print(f"[시작 {time.strftime('%Y-%m-%d %H:%M:%S')}] 병렬 · n {n} · substeps {SUB} · 프레임 {FRAMES} · "
      f"색 {fu.ip_colors}/{fu.bd_colors} · 코드에서 센 태스크 {fu.n_tasks_expected()} · "
      f"arch {arch} · 초기화 {init_s:.1f}s", flush=True)

# JIT 은 벽시계 밖으로 뺀다 — 1프레임 예열 후 상태를 되감는다(v4-11 l3prof 와 같은 처분)
t_jit = time.perf_counter()
fu.step(1, SUB, DT, G, DAMP, **FLAGS)
jit_s = time.perf_counter() - t_jit
fu.pos.from_numpy(np.ascontiguousarray(pos0, dtype=npfp))
fu.vel.from_numpy(np.ascontiguousarray(vel0, dtype=npfp))
ti.sync()
print(f"  예열(JIT 포함 1프레임) {jit_s:.1f}s · 상태 되감음", flush=True)

ref = fu.pos.to_numpy().astype(np.float64)
trail, wall, frame, deg = [], [], 0, 0
t0 = time.perf_counter()
while frame < FRAMES:
    w = min(N_WIN, FRAMES - frame)
    _, _, d = fu.step(w, SUB, DT, G, DAMP, **FLAGS)
    deg += d
    p = fu.pos.to_numpy().astype(np.float64)
    frame += w
    if not np.isfinite(p).all():
        print(f"  ★ 발산 — f={frame} 에 비유한값", flush=True)
        break
    net = float(np.linalg.norm(p - ref, axis=1).max())
    el = time.perf_counter() - t0
    trail.append((frame, net))
    wall.append((frame, el))
    print(f"  f={frame} net={net:.6e} ({el:.1f}s · {el/frame:.3f} s/프레임) "
          f"[{time.strftime('%H:%M:%S')}]", flush=True)
    ref = p
el = time.perf_counter() - t0
p = fu.pos.to_numpy().astype(np.float64)
p.tofile(str(out) + ".bin")
SERIAL_REF = 12.690        # v4-10 직렬 s/프레임(회차 프롬프트가 지정한 분모 · §0-4ㅁ)
spf = el / max(frame, 1)
meta = {"cell": CELL, "cons": "all", "fp": FPN, "arch": arch, "n": n, "substeps": SUB,
        "frames": frame, "N_WIN": N_WIN, "colors": [fu.ip_colors, fu.bd_colors],
        "tasksCounted": fu.n_tasks_expected(), "sec": el, "secPerFrame": spf,
        "jitSec": jit_s, "initSec": init_s, "degenerate": deg,
        "serialRefSecPerFrame": SERIAL_REF, "speedup": SERIAL_REF / spf,
        "finite": bool(np.isfinite(p).all()), "trail": trail, "wall": wall}
json.dump(meta, open(str(out) + ".json", "w", encoding="utf-8"), indent=1, ensure_ascii=False)
print(f"[병렬] 프레임 {frame} · {el:.1f}s ({spf:.3f} s/프레임) · "
      f"직렬 {SERIAL_REF} 대비 **{SERIAL_REF/spf:.2f}배** · degenerate {deg}")
print(f"  → {out}.json / .bin")
