"""v4-07 §1-③ — **층2 대조**(v3 ↔ v4). **최종 정점만** 본다(궤적 0 · 함정 39).

  v3 쪽 = `cellconv7-<CELL>-all-e0-x<P>.bin`  (헤더 + pos + vel)   ← §1-① 기본 실행의 연장 P 스냅
  v4 쪽 = `l2-<CELL>-all-<fp>-x<P>.bin`       (헤더 없는 f64 3n)   ← `gpu/l2_run.py`

**상한을 등재하지 않는다**(v4-04 §0-2 층2). 이 파일이 내는 것은 «실측 분포»뿐이다 —
최대·중앙·p99·축별·분위, 그리고 양쪽 수렴 프레임 수. 판정은 회차 갈래가 한다.

진입: `py gpu/l2_cmp.py [P] [fp]`
"""
import json
import struct
import sys
from pathlib import Path

import numpy as np

EXPORT = Path(__file__).resolve().parent / "oracle" / "export"
CELL, KIND = "c100-h170-s45_M", "all"
P = int(sys.argv[1]) if len(sys.argv) > 1 else 0
FPN = sys.argv[2] if len(sys.argv) > 2 else "f32"


def v3_snap(off):
    raw = (EXPORT / f"cellconv7-{CELL}-{KIND}-e0-x{off}.bin").read_bytes()
    (hl,) = struct.unpack_from("<I", raw, 0)
    h = json.loads(raw[4:4 + hl].decode("utf-8"))
    return h, np.frombuffer(raw, "<f8", count=h["n"] * 3, offset=4 + hl).reshape(h["n"], 3)


h3, p3 = v3_snap(P)
p4 = np.fromfile(EXPORT / f"l2-{CELL}-{KIND}-{FPN}-x{P}.bin", dtype="<f8").reshape(-1, 3)
j4 = json.loads((EXPORT / f"l2-{CELL}-{KIND}-{FPN}.json").read_text(encoding="utf-8"))
assert p3.shape == p4.shape, f"정점 수가 다르다 — v3 {p3.shape} ≠ v4 {p4.shape}"

d = np.abs(p3 - p4)
dist = np.linalg.norm(p3 - p4, axis=1)
per_v = d.max(axis=1)
c3, c4 = p3.mean(axis=0), p4.mean(axis=0)

r = {
    "cell": CELL, "kind": KIND, "fp": FPN, "P": P, "n": int(p3.shape[0]),
    "v3": {"convFrame": h3["convFrame"], "convNet": h3["convNet"],
           "frame": h3["frame"], "net": h3["net"]},
    "v4": {"convFrame": j4["convFrame"], "convNet": j4["convNet"],
           "frame": j4["snaps"].get(str(P), {}).get("frame"), "sec": j4["sec"],
           "secPerFrame": j4["secPerFrame"], "arch": j4["arch"], "converged": j4["converged"]},
    "coord": {"max": float(d.max()), "med": float(np.median(per_v)),
              "p99": float(np.percentile(per_v, 99)),
              "axis": [float(d[:, i].max()) for i in range(3)]},
    "dist": {"max": float(dist.max()), "med": float(np.median(dist)),
             "p99": float(np.percentile(dist, 99)), "mean": float(dist.mean())},
    "centroid": {"v3": c3.tolist(), "v4": c4.tolist(),
                 "delta_mm": [(float(c4[i] - c3[i]) * 1000) for i in range(3)]},
    "quantiles_mm": {q: float(np.percentile(dist, q) * 1000) for q in (50, 75, 90, 95, 99, 100)},
}
(EXPORT / f"l2cmp-{CELL}-{KIND}-{FPN}-x{P}.json").write_text(json.dumps(r, indent=1), encoding="utf-8")
print(f"[층2 대조 · 연장 P={P} · {FPN}] n={r['n']}")
print(f"  v3 수렴프레임 {r['v3']['convFrame']} (net {r['v3']['convNet']:.6e}) · 대조 프레임 {r['v3']['frame']}")
print(f"  v4 수렴프레임 {r['v4']['convFrame']} (net {r['v4']['convNet']:.6e}) · 대조 프레임 {r['v4']['frame']} · "
      f"{r['v4']['secPerFrame']:.2f} s/프레임 · {r['v4']['arch']}")
print(f"  좌표차  최대 {r['coord']['max']:.6e}  중앙 {r['coord']['med']:.6e}  p99 {r['coord']['p99']:.6e}")
print(f"  축별    x {r['coord']['axis'][0]:.6e}  y {r['coord']['axis'][1]:.6e}  z {r['coord']['axis'][2]:.6e}")
print(f"  거리차  최대 {r['dist']['max']:.6e}  중앙 {r['dist']['med']:.6e}  평균 {r['dist']['mean']:.6e}")
print(f"  중심차  x {r['centroid']['delta_mm'][0]:+.4f}  y {r['centroid']['delta_mm'][1]:+.4f}  "
      f"z {r['centroid']['delta_mm'][2]:+.4f} mm")
print("  거리 분위(mm): " + " · ".join(f"p{q} {v:.4f}" for q, v in r["quantiles_mm"].items()))
