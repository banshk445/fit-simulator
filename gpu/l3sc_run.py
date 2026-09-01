"""v4-14 §1-①② — **셀프 충돌만 1서브스텝**(층1 의 v4 쪽) + **후보 쌍 집합** 덤프.

v3 쪽 계기 `scripts/v4SelfStep.ts` 와 «같은 것»을 만든다 — 같은 초기 상태(그 스크립트가 낸
`l3sc-v3-…-pre.bin` = 정착 blob 의 f64 원본) · 같은 삼각형 배열(`…-tris.bin`) · 같은 두께 ·
**셀프 충돌만 1회**(예측 0 · 다른 제약 0 · 몸 충돌 0 · 속도 갱신 0).

★ 순서 두 판을 «둘 다» 낸다(§0-5ㄹ) — `v3`(재현 순서) 와 `nat`(병렬 자연 순서).
  판정에 쓰는 것은 `v3` 이고, `nat` 은 「①의 갈래가 무엇에 걸려 있는가」를 값으로 남기는 채널이다.
진입: `py gpu/l3sc_run.py <cuda|x64> <f64|f32>`
"""
import json
import sys
import time
from pathlib import Path

import numpy as np
import taichi as ti

sys.path.insert(0, str(Path(__file__).resolve().parent))
from oracle import load  # noqa: E402
from engine import selfcol as SC  # noqa: E402

CELL = "c100-h170-s45_M"
ARCH = sys.argv[1] if len(sys.argv) > 1 else "cuda"
FPN = sys.argv[2] if len(sys.argv) > 2 else "f64"
ARCH_T = {"cuda": ti.cuda, "x64": ti.x64, "arm64": ti.arm64}[ARCH]
fp, npfp = ({"f32": (ti.f32, np.float32), "f64": (ti.f64, np.float64)})[FPN]

v3j = json.load(open(load.EXPORT / f"l3sc-v3-{CELL}.json", encoding="utf-8"))
pre = np.fromfile(load.EXPORT / f"l3sc-v3-{CELL}-pre.bin", dtype=np.float64).reshape(-1, 3)
tris = np.fromfile(load.EXPORT / f"l3sc-v3-{CELL}-tris.bin", dtype=np.int32).reshape(-1, 3)
hs, invm, ip_idx, ip_par = load.scene(CELL)
n = hs["n"]
assert pre.shape[0] == n == v3j["n"], f"정점 수 {pre.shape[0]} ≠ {n}"
assert tris.shape[0] == v3j["T"], f"삼각형 수 {tris.shape[0]} ≠ {v3j['T']}"
THICK = float(v3j["thickness"])

ti.init(arch=ARCH_T, default_fp=fp)
arch = str(ti.lang.impl.current_cfg().arch)
assert ti.lang.impl.current_cfg().arch == ARCH_T, f"조용한 arch 폴백(v4-01 함정 1) — {arch}"

pos = ti.Vector.field(3, fp, shape=n)
iv = ti.field(fp, shape=n)
iv.from_numpy(invm.astype(npfp))
sc = SC.SelfCol(pos, iv, tris, THICK, fp=fp)

out = {}
for order in ("v3", "nat"):
    pos.from_numpy(np.ascontiguousarray(pre, dtype=npfp))
    ti.sync()
    t0 = time.perf_counter()
    st = sc.apply(order=order)
    ti.sync()
    el = time.perf_counter() - t0
    p = pos.to_numpy().astype(np.float64)
    d = np.linalg.norm(p - pre, axis=1)
    st.update(sec=el, moved=int((d > 0).sum()), maxMoveM=float(d.max()))
    out[order] = st
    p.tofile(str(load.EXPORT / f"l3sc-v4-{CELL}-{FPN}-{ARCH}-{order}.bin"))
    print(f"[{order}] {json.dumps(st, ensure_ascii=False)}", flush=True)

pr = sc.pair.to_numpy()[: int(sc.npair[None])]
pr = pr[np.lexsort((pr[:, 1], pr[:, 0]))]
pr.astype(np.int32).tofile(str(load.EXPORT / f"l3sc-v4-{CELL}-{FPN}-{ARCH}-pairs.bin"))

meta = {"what": "v4-14 §1-①② — v4 셀프 충돌 1서브스텝", "cell": CELL, "fp": FPN, "arch": arch,
        "n": n, "T": int(tris.shape[0]), "thickness": THICK, "sep": 2 * THICK,
        "v3": {k: v3j[k] for k in ("근접쌍", "해소횟수", "최대침투m", "움직인정점", "최대변위m")},
        "v4": out}
json.dump(meta, open(load.EXPORT / f"l3sc-v4-{CELL}-{FPN}-{ARCH}.json", "w", encoding="utf-8"),
          indent=1, ensure_ascii=False)
print(json.dumps(meta, ensure_ascii=False, indent=1))
