"""v4-12 §1-② «보조 채널» — **서브스텝 경계** 대조. 한 프레임 = 229 서브스텝이므로 `f=1` 은
「1스텝」이 아니다 — 등재 갈래 (나) 의 이름과 정의역이 어긋나는 자리를 «값으로» 가른다.

v3 쪽 덤프 = `scripts/v4SubstepDump.ts`(`step(dt=DT/229, substeps=1)` 반복 = 정확히 한 서브스텝).
v4 쪽도 **같은 규약**으로 부른다: `fu.step(1, 1, DT/229, …)`.
★ 이 규약의 h 는 본 실행과 «같은 식»(DT/229)이고, v4 쪽은 f32 로 반올림된 같은 값이다(≤1 ULP).
★ **갈래 판정은 §0-4ㄷ 대로 f=1(한 프레임) 기준 그대로 둔다** — 이 채널은 «자리 후보» 등재용이다.

진입: `py gpu/l3sub_run.py`
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
fp, npfp = ti.f32, np.float32
FLAGS = dict(use_ip=1, use_bd=1, use_sm=1, use_col=1)

hs, invm, ip_idx, ip_par = load.scene(CELL)
hb, bd_idx, bd_par = load.scene_bend(CELL)
hm, sm_idx, sm_rest = SE.load_seam(load.EXPORT / f"scene-seam-{CELL}.bin")
sh, sdata = CO.load_sdf(load.EXPORT / f"sdf-{BODY}.bin")
n = hs["n"]
head, st, _ = load.cloth(CELL)
pos0 = st[: n * 3].reshape(n, 3).astype(np.float64)
vel0 = st[n * 3:].reshape(n, 3).astype(np.float64)

raw = np.fromfile(load.EXPORT / f"l3sub-v3-{CELL}.bin", dtype=np.uint8)
hl = int(np.frombuffer(raw[:4].tobytes(), dtype="<u4")[0])
v3h = json.loads(raw[4:4 + hl].tobytes().decode("utf-8"))
v3 = np.frombuffer(raw[4 + hl:].tobytes(), dtype=np.float64).reshape(-1, n, 3)
SUBS = list(v3h["subs"])
SUB = int(v3h["substepsPerFrame"])
assert np.array_equal(v3[0], pos0), "v3 s=0 이 정착 blob 원본과 다르다"

ti.init(arch=ti.cuda, default_fp=fp)
arch = str(ti.lang.impl.current_cfg().arch)
assert ti.lang.impl.current_cfg().arch == ti.cuda, "조용한 arch 폴백(v4-01 함정 1)"
fu = F.Full(pos0.astype(npfp), vel0.astype(npfp), invm.astype(npfp),
            ip_idx, ip_par.astype(npfp), hs["k"], bd_idx, bd_par.astype(npfp), hb["ke"],
            sm_idx, sm_rest.astype(npfp), sh, sdata, sh["THICK"], sh["MU"], fp=fp)

DT, G, DAMP = 1 / 60, 9.81, 6.0
DT_SUB = DT / SUB
ULP1 = 2.0 ** -23 * 1e3
print(f"[시작 {time.strftime('%Y-%m-%d %H:%M:%S')}] 서브스텝 주사 · n {n} · 서브스텝/프레임 {SUB} · "
      f"dtSub {DT_SUB:.9e} · arch {arch} · v3 m {v3h['m']}", flush=True)

rows = []
t0 = time.perf_counter()
for i, s in enumerate(SUBS):
    if i > 0:
        fu.step(SUBS[i] - SUBS[i - 1], 1, DT_SUB, G, DAMP, **FLAGS)
    p = fu.pos.to_numpy().astype(np.float64)
    d = p - v3[i]
    dist = np.linalg.norm(d, axis=1)
    r = dict(sub=s, maxCoordMm=float(np.abs(d).max()) * 1e3, maxDistMm=float(dist.max()) * 1e3,
             medDistMm=float(np.median(dist)) * 1e3, maxAt=int(dist.argmax()))
    rows.append(r)
    print(f"  s={s:<4} 최대좌표차 {r['maxCoordMm']:.6e} mm · 최대거리 {r['maxDistMm']:.6e} mm · "
          f"중앙거리 {r['medDistMm']:.6e} mm · maxAt {r['maxAt']}", flush=True)
el = time.perf_counter() - t0
out = load.EXPORT / f"l3sub-cmp-{CELL}"
json.dump({"cell": CELL, "n": n, "substepsPerFrame": SUB, "dtSub": DT_SUB, "arch": arch,
           "ulp1mMm": ULP1, "subs": SUBS, "rows": rows, "sec": el},
          open(str(out) + ".json", "w", encoding="utf-8"), indent=1, ensure_ascii=False)
print(f"[보조] s=1 최대좌표차 {rows[1]['maxCoordMm']:.6e} mm · s=0 {rows[0]['maxCoordMm']:.6e} mm · "
      f"비 {rows[1]['maxCoordMm']/rows[0]['maxCoordMm']:.3f} · f32 ULP(1m) {ULP1:.6e} mm")
print(f"  {el:.1f}s → {out}.json")
