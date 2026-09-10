"""v4-09 §1-① — **v4 미수렴 «진단»**. 사실만 낸다 — 처방 0 · 원인 단정 0 · 귀속 0.

`engine/full.py` 를 **그대로** 부른다(로직 diff 0 · §0-3). 이 파일이 «더» 하는 것은
창 경계마다 위치를 손에 들고 있다가 **마지막 세 창의 정점별 변위**를 세는 것뿐이다.

몸 충돌 «발화 여부»는 SDF 를 **numpy 로 다시 샘플링**해서 센다(격자·삼선형은 `collide.py:_sample`
= `bodySdf.ts:246` 과 같은 식을 옮겨 적은 **복제 계기**다 · **진단 전용 · 판정 채널 아님**).

진입: `py gpu/l3_diag.py [cons] [frames] [fp]`   (예: `py gpu/l3_diag.py all 180 f32`)
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
FLAGS = {"all": dict(use_ip=1, use_bd=1, use_sm=1, use_col=1),
         "ipseam": dict(use_ip=1, use_bd=0, use_sm=1, use_col=1),
         "bendseam": dict(use_ip=0, use_bd=1, use_sm=1, use_col=1)}[CONS]

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
out = load.EXPORT / f"l3diag-{CELL}-{CONS}-{FPN}-f{FRAMES}"

# ── SDF 복제 샘플러(진단 전용) — collide.py:_sample 와 같은 식 ──────────────
GX, GY, GZ = int(sh["nx"]), int(sh["ny"]), int(sh["nz"])
OX, OY, OZ, HH, BAND = (float(sh["ox"]), float(sh["oy"]), float(sh["oz"]),
                        float(sh["h"]), float(sh["band"]))
GRID = np.asarray(sdata, dtype=np.float32).reshape(GZ, GY, GX)


def sdf_at(P):
    f = (P - np.array([OX, OY, OZ])) / HH
    ok = np.all((f >= 0) & (f <= np.array([GX - 1, GY - 1, GZ - 1])), axis=1)
    i = np.minimum(GX - 2, np.floor(f[:, 0]).astype(int)).clip(0)
    j = np.minimum(GY - 2, np.floor(f[:, 1]).astype(int)).clip(0)
    k = np.minimum(GZ - 2, np.floor(f[:, 2]).astype(int)).clip(0)
    tx, ty, tz = f[:, 0] - i, f[:, 1] - j, f[:, 2] - k
    g = lambda a, b, c: GRID[c, b, a]
    c00 = g(i, j, k) * (1 - tx) + g(i + 1, j, k) * tx
    c10 = g(i, j + 1, k) * (1 - tx) + g(i + 1, j + 1, k) * tx
    c01 = g(i, j, k + 1) * (1 - tx) + g(i + 1, j, k + 1) * tx
    c11 = g(i, j + 1, k + 1) * (1 - tx) + g(i + 1, j + 1, k + 1) * tx
    v = (c00 * (1 - ty) + c10 * ty) * (1 - tz) + (c01 * (1 - ty) + c11 * ty) * tz
    return np.where(ok, v, BAND)


# ── 제약 소속(정점별 개수) ────────────────────────────────────────────────
deg_ip = np.bincount(np.asarray(ip_idx).ravel(), minlength=n)
deg_bd = np.bincount(np.asarray(bd_idx).ravel(), minlength=n)
deg_sm = np.bincount(np.asarray(sm_idx).ravel(), minlength=n)

ref = fu.pos.to_numpy().astype(np.float64)
hist, trail = [ref.copy()], []
t0 = time.perf_counter()
frame = 0
while frame < FRAMES:
    w = min(N_WIN, FRAMES - frame)
    fu.step(w, SUB, DT, G, DAMP, **FLAGS)
    pos = fu.pos.to_numpy().astype(np.float64)
    frame += w
    net = float(np.linalg.norm(pos - ref, axis=1).max())
    trail.append((frame, net))
    print(f"  f={frame} net={net:.6e} ({time.perf_counter() - t0:.0f}s)", flush=True)
    ref = pos
    hist.append(pos.copy())
    if len(hist) > 4:
        hist.pop(0)
el = time.perf_counter() - t0
pos = fu.pos.to_numpy().astype(np.float64)
pos.tofile(str(out) + ".bin")

# ── 마지막 세 창의 정점별 변위 ────────────────────────────────────────────
def window(a, b):
    d = np.linalg.norm(hist[b] - hist[a], axis=1)
    top = np.argsort(-d)[:100]
    return d, top


diag = {}
pairs = [(len(hist) - 2, len(hist) - 1), (len(hist) - 3, len(hist) - 2),
         (len(hist) - 4, len(hist) - 3)]
tops = []
for a, b in pairs:
    if a < 0:
        continue
    d, top = window(a, b)
    fa = frame - (len(hist) - 1 - a) * N_WIN
    fb = frame - (len(hist) - 1 - b) * N_WIN
    P = hist[b]
    dv = sdf_at(P) - float(sh["THICK"])
    key = f"f{fa}->f{fb}"
    tops.append(set(top.tolist()))
    diag[key] = {
        "창변위_mm": {"중앙": float(np.median(d)) * 1e3, "p99": float(np.percentile(d, 99)) * 1e3,
                      "최대": float(d.max()) * 1e3, "최대정점": int(d.argmax())},
        "상위100": {
            "변위_mm": {"최소": float(d[top].min()) * 1e3, "중앙": float(np.median(d[top])) * 1e3,
                        "최대": float(d[top].max()) * 1e3},
            "y_cm": {"최소": float(P[top, 1].min()) * 100, "중앙": float(np.median(P[top, 1])) * 100,
                     "최대": float(P[top, 1].max()) * 100},
            "x_cm": {"최소": float(P[top, 0].min()) * 100, "최대": float(P[top, 0].max()) * 100},
            "z_cm": {"최소": float(P[top, 2].min()) * 100, "최대": float(P[top, 2].max()) * 100},
            "제약소속_중앙": {"늘어남": float(np.median(deg_ip[top])), "굽힘": float(np.median(deg_bd[top])),
                              "봉제": float(np.median(deg_sm[top]))},
            "봉제정점_수": int((deg_sm[top] > 0).sum()),
            "SDF_d_mm": {"중앙": float(np.median(dv[top])) * 1e3, "최소": float(dv[top].min()) * 1e3,
                          "최대": float(dv[top].max()) * 1e3},
            "몸충돌_발화수": int((dv[top] < 0).sum()),
        },
        "전체": {
            "y_cm": {"중앙": float(np.median(P[:, 1])) * 100},
            "제약소속_중앙": {"늘어남": float(np.median(deg_ip)), "굽힘": float(np.median(deg_bd)),
                              "봉제": float(np.median(deg_sm))},
            "봉제정점_수": int((deg_sm > 0).sum()),
            "SDF_d_mm_중앙": float(np.median(dv)) * 1e3,
            "몸충돌_발화수": int((dv < 0).sum()),
        },
    }
if len(tops) >= 2:
    diag["상위100_교집합"] = {"직전창과": len(tops[0] & tops[1]),
                              "두창전과": (len(tops[0] & tops[2]) if len(tops) > 2 else None)}

meta = {"cell": CELL, "cons": CONS, "fp": FPN, "n": n, "substeps": SUB, "frames": frame,
        "N_WIN": N_WIN, "sec": el, "secPerFrame": el / max(frame, 1), "initSec": init_s,
        "arch": arch, "trail": trail, "diag": diag,
        "deg": {"늘어남_중앙": float(np.median(deg_ip)), "굽힘_중앙": float(np.median(deg_bd)),
                "봉제정점_수": int((deg_sm > 0).sum())}}
json.dump(meta, open(str(out) + ".json", "w", encoding="utf-8"), indent=1, ensure_ascii=False)
print(f"[진단 {CONS} {FPN}] 프레임 {frame} · {el:.1f}s ({el / max(frame,1):.3f} s/프레임) · arch {arch}")
print(json.dumps(diag, ensure_ascii=False, indent=1))
print(f"  → {out}.json")
