"""v4-10 §1-①ㄱ·④ — **직렬 180프레임 재실행**. `engine/full.py` 를 «그대로» 부른다(로직 diff 0).

v4-09 의 `l3_diag.py` 와 물리는 **같은 것**이고, 이 파일이 «더» 하는 것은 둘뿐이다:
```
 ① 창마다의 위치를 **전량 저장**한다(`l3dom-*.npz`) ⟹ 마지막 세 창의 **상위 100 «인덱스»**가
    남는다. v4-09 는 집계만 남기고 인덱스를 버려서 ①ㄱ 이 그것을 다시 만들 수 없었다.
 ② **f=60 위치**를 따로 판다(`-f60.bin`) ⟹ §1-④ 의 «직렬 60프레임» 기준선이 된다
    (별도 직렬 실행 0 · §0-6ㄷ).
```
★ 물리 diff 0 증명 = **창 순변위가 `l3_diag.py`(v4-09) 와 인쇄 자릿수 전량 동일**해야 한다.

진입: `py gpu/l3_dom.py [cons] [frames] [fp]`
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
fu = F.Full(pos0.astype(npfp), vel0.astype(npfp), invm.astype(npfp),
            ip_idx, ip_par.astype(npfp), hs["k"], bd_idx, bd_par.astype(npfp), hb["ke"],
            sm_idx, sm_rest.astype(npfp), sh, sdata, sh["THICK"], sh["MU"], fp=fp)
init_s = time.perf_counter() - t_init

DT, G, DAMP, SUB, N_WIN = 1 / 60, 9.81, 6.0, hs["substeps"], 10
out = load.EXPORT / f"l3dom-{CELL}-{CONS}-{FPN}-f{FRAMES}"

print(f"[시작 {time.strftime('%Y-%m-%d %H:%M:%S')}] 직렬 {CONS} {FPN} · n {n} · substeps {SUB} · "
      f"arch {arch} · 초기화 {init_s:.1f}s", flush=True)

snaps = {0: fu.pos.to_numpy().astype(np.float64)}
ref = snaps[0]
trail, wall = [], []
t0 = time.perf_counter()
frame = 0
while frame < FRAMES:
    w = min(N_WIN, FRAMES - frame)
    fu.step(w, SUB, DT, G, DAMP, **FLAGS)
    pos = fu.pos.to_numpy().astype(np.float64)
    frame += w
    net = float(np.linalg.norm(pos - ref, axis=1).max())
    el = time.perf_counter() - t0
    trail.append((frame, net))
    wall.append((frame, el))
    snaps[frame] = pos
    print(f"  f={frame} net={net:.6e} ({el:.0f}s · {el/frame:.3f} s/프레임) "
          f"[{time.strftime('%H:%M:%S')}]", flush=True)
    ref = pos
el = time.perf_counter() - t0
pos = snaps[frame]
pos.tofile(str(out) + ".bin")
if 60 in snaps:
    snaps[60].tofile(str(out.parent / f"l3dom-{CELL}-{CONS}-{FPN}-f60") + ".bin")

# ── 마지막 세 창의 상위 100 «인덱스» ────────────────────────────────────────
keys = sorted(snaps)
tops = {}
for b in keys[-3:]:
    a = b - N_WIN
    if a not in snaps:
        continue
    d = np.linalg.norm(snaps[b] - snaps[a], axis=1)
    top = np.argsort(-d)[:100]
    tops[f"f{a}->f{b}"] = {"top100": [int(x) for x in top],
                           "d_mm": [float(x) * 1e3 for x in d[top]],
                           "중앙_mm": float(np.median(d)) * 1e3,
                           "p99_mm": float(np.percentile(d, 99)) * 1e3,
                           "최대_mm": float(d.max()) * 1e3, "최대정점": int(d.argmax())}
np.savez_compressed(str(out) + ".npz", **{f"f{k}": v for k, v in snaps.items()})

meta = {"cell": CELL, "cons": CONS, "fp": FPN, "n": n, "substeps": SUB, "frames": frame,
        "N_WIN": N_WIN, "sec": el, "secPerFrame": el / max(frame, 1), "initSec": init_s,
        "arch": arch, "trail": trail, "wall": wall, "tops": tops,
        "sec60": next((e for f_, e in wall if f_ == 60), None)}
json.dump(meta, open(str(out) + ".json", "w", encoding="utf-8"), indent=1, ensure_ascii=False)
print(f"[직렬 {CONS} {FPN}] 프레임 {frame} · {el:.1f}s ({el/max(frame,1):.3f} s/프레임) · arch {arch}")
print(f"  → {out}.json / .bin / .npz")
