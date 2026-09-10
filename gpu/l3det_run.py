"""v4-11 §1-① — **결정성 검사**. v4 「직렬」판(`engine/full.py`)으로 **같은 칸 · 같은 초기 상태**를
«두 번» 60프레임 돌려 최종 정점을 **비트 대조**한다.

```
 비트 대조의 정의(§0-4ㄱ · 값을 보기 «전»에 등재) —
   `pos.to_numpy()`(f32) 의 **원시 바이트 sha256 일치** + `np.array_equal` · `vel` 도 같이 센다.
   보조로 **최대 좌표차 · 다른 정점 수**를 항상 인쇄한다(같으면 0 으로 찍힌다).
 ★ 두 실행은 **같은 프로세스 · 같은 컴파일 산출**이다 — 묻는 것은 커널 «안»의 쓰기 경쟁이다.
   상태는 같은 `pos0/vel0` 로 되감는다(`from_numpy`).
```

★ `engine/full.py` **바이트 불변** · 물리 식 0줄 · `src/` diff 0.
진입: `py gpu/l3det_run.py [frames]`
"""
import hashlib
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
FRAMES = int(sys.argv[1]) if len(sys.argv) > 1 else 60
FPN = "f32"
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
fu = F.Full(pos0, vel0, invm.astype(npfp),
            ip_idx, ip_par.astype(npfp), hs["k"], bd_idx, bd_par.astype(npfp), hb["ke"],
            sm_idx, sm_rest.astype(npfp), sh, sdata, sh["THICK"], sh["MU"], fp=fp)
init_s = time.perf_counter() - t_init

DT, G, DAMP, SUB, N_WIN = 1 / 60, 9.81, 6.0, hs["substeps"], 10
out = load.EXPORT / f"l3det-{CELL}-all-{FPN}-f{FRAMES}"
print(f"[시작 {time.strftime('%Y-%m-%d %H:%M:%S')}] 결정성 검사 · n {n} · substeps {SUB} · "
      f"프레임 {FRAMES} · arch {arch} · 초기화 {init_s:.1f}s", flush=True)


def run_once(tag):
    fu.pos.from_numpy(np.ascontiguousarray(pos0, dtype=npfp))
    fu.vel.from_numpy(np.ascontiguousarray(vel0, dtype=npfp))
    ti.sync()
    ref = fu.pos.to_numpy().astype(np.float64)
    trail, frame = [], 0
    t0 = time.perf_counter()
    deg = 0
    while frame < FRAMES:
        w = min(N_WIN, FRAMES - frame)
        _, _, d = fu.step(w, SUB, DT, G, DAMP, **FLAGS)
        deg += d
        p = fu.pos.to_numpy().astype(np.float64)
        frame += w
        net = float(np.linalg.norm(p - ref, axis=1).max())
        el = time.perf_counter() - t0
        trail.append((frame, net))
        print(f"  [{tag}] f={frame} net={net:.6e} ({el:.0f}s · {el/frame:.3f} s/프레임) "
              f"[{time.strftime('%H:%M:%S')}]", flush=True)
        ref = p
    el = time.perf_counter() - t0
    P = fu.pos.to_numpy()
    V = fu.vel.to_numpy()
    return dict(tag=tag, sec=el, secPerFrame=el / FRAMES, trail=trail, degenerate=deg,
                posSha=hashlib.sha256(np.ascontiguousarray(P).tobytes()).hexdigest(),
                velSha=hashlib.sha256(np.ascontiguousarray(V).tobytes()).hexdigest()), P, V


m1, P1, V1 = run_once("1회")
m2, P2, V2 = run_once("2회")

pos_same = bool(np.array_equal(P1, P2))
vel_same = bool(np.array_equal(V1, V2))
dv = np.linalg.norm(P1.astype(np.float64) - P2.astype(np.float64), axis=1)
nd = int((dv > 0).sum())
res = {
    "cell": CELL, "cons": "all", "fp": FPN, "n": n, "substeps": SUB, "frames": FRAMES,
    "arch": arch, "initSec": init_s, "run1": m1, "run2": m2,
    "posBitEqual": pos_same, "velBitEqual": vel_same,
    "posShaEqual": m1["posSha"] == m2["posSha"], "velShaEqual": m1["velSha"] == m2["velSha"],
    "maxCoordDiffMm": float(np.abs(P1.astype(np.float64) - P2.astype(np.float64)).max()) * 1e3,
    "maxVertexDistMm": float(dv.max()) * 1e3, "diffVertices": nd,
    "trailEqual": m1["trail"] == m2["trail"],
}
P1.astype(np.float64).tofile(str(out) + "-run1.bin")
P2.astype(np.float64).tofile(str(out) + "-run2.bin")
json.dump(res, open(str(out) + ".json", "w", encoding="utf-8"), indent=1, ensure_ascii=False)
print(f"[결정성] pos 비트동일 {pos_same} · vel 비트동일 {vel_same} · "
      f"sha 일치 {res['posShaEqual']}/{res['velShaEqual']} · 다른 정점 {nd}/{n} · "
      f"최대 좌표차 {res['maxCoordDiffMm']:.9f} mm · 궤적 동일 {res['trailEqual']}")
print(f"  pos sha1회 {m1['posSha']}")
print(f"  pos sha2회 {m2['posSha']}")
print(f"  → {out}.json")
