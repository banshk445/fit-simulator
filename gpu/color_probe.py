"""v4-10 §1-③ — **굽힘 컬러링 «가능성»**. 실행 0(GPU 를 쓰지 않는다) · 색 수와 비용만 낸다.

컬러링 알고리즘은 v4-09 의 `engine/full_color.py:greedy_color` 를 **그대로 import** 한다
(재작성 0 · 사본 0). 이 파일이 하는 것은 그 함수를 **굽힘 인덱스에도 걸어 보는 것**과
**같은 색 안 정점 공유 0 을 기계로 세는 것**뿐이다.

진입: `py gpu/color_probe.py`
"""
import json
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from oracle import load  # noqa: E402
from engine.full_color import greedy_color  # noqa: E402
from engine import seam as SE  # noqa: E402

CELL = "c100-h170-s45_M"
hs, invm, ip_idx, ip_par = load.scene(CELL)
hb, bd_idx, bd_par = load.scene_bend(CELL)
hm, sm_idx, sm_rest = SE.load_seam(load.EXPORT / f"scene-seam-{CELL}.bin")
n = hs["n"]


def check(idx, color, nc):
    """색마다 정점 인덱스를 늘어놓아 «중복이 0»인지 센다 — 눈으로 안 본다."""
    bad = []
    for c in range(nc):
        vs = np.asarray(idx)[color == c].ravel()
        u = np.unique(vs)
        if u.size != vs.size:
            bad.append((c, int(vs.size - u.size)))
    return bad


out = {"cell": CELL, "n": n}
for name, idx in (("늘어남", np.asarray(ip_idx, np.int32)),
                  ("굽힘", np.asarray(bd_idx, np.int32)),
                  ("봉제", np.asarray(sm_idx, np.int32))):
    t0 = time.perf_counter()
    col = greedy_color(idx, n)
    el = time.perf_counter() - t0
    nc = int(col.max()) + 1
    sizes = [int(x) for x in np.bincount(col, minlength=nc)]
    bad = check(idx, col, nc)
    deg = np.bincount(idx.ravel(), minlength=n)
    out[name] = {"제약수": int(idx.shape[0]), "정점차수": int(idx.shape[1]),
                 "색수": nc, "색별제약수": sizes, "합": int(sum(sizes)),
                 "컬러링_s": el, "정점공유_위반색": bad,
                 "최대색크기": max(sizes), "최소색크기": min(sizes),
                 "정점최대소속수": int(deg.max())}
    print(f"[{name}] 제약 {idx.shape[0]} (정점 {idx.shape[1]}개) · 색 {nc} · {el:.3f}s · "
          f"정점공유 위반색 {len(bad)} · 색별 {sizes}", flush=True)

json.dump(out, open(load.EXPORT / "l3-color-probe.json", "w", encoding="utf-8"),
          indent=1, ensure_ascii=False)
print(f"  → {load.EXPORT / 'l3-color-probe.json'}")
