"""v4-14 §1-①② 판정 계기 — 층1(자 = K × ULP)과 쌍 집합 대조. 계산만 · 물리 0스텝.

★ `gpu/engine/ulp.py` 는 **수정 0**(§0-3) — f64 자는 여기서 만든다(f32 판과 «같은 식» · 지수만 −52).
★ K 는 **커널 코드에서 «센» 수**다(§0-5ㄴ · 세부는 `docs/v4/14-셀프충돌.md` §1-①ㄴ 표) —
  실측을 보고 고르지 않는다. 깊이(엄격)와 총량(느슨)을 둘 다 두고 **깊이로 판정한다**.
진입: `py gpu/l3sc_cmp.py <arch>`
"""
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from oracle import load  # noqa: E402
from engine.ulp import ulp_f32_arr  # noqa: E402  (f32 자는 정본 그대로 인용)

CELL = "c100-h170-s45_M"
ARCH = sys.argv[1] if len(sys.argv) > 1 else "cuda"
K_DEPTH = 32          # 셀프 충돌 1접촉의 «깊이»(코드에서 셈 · §1-①ㄴ)
K_OPS = 188           # 총량(느슨한 쪽 · 판정에 쓰지 않는다)


def ulp_f64_arr(x):
    """`ulp.py:ulp_f32_arr` 와 «같은 식» · 지수만 −52(f64 유효자리)."""
    a = np.abs(np.asarray(x, dtype=np.float64))
    out = np.zeros_like(a)
    nz = a > 0
    out[nz] = 2.0 ** (np.floor(np.log2(a[nz])) - 52)
    return out


def layer1(diff, ref, k, ulp_arr):
    """`ulp.py:layer1` 과 같은 규약 — 자리 값 = 그 정점 위치의 최대 성분 · deg 1."""
    d = np.max(np.abs(diff), axis=1)
    b = k * ulp_arr(np.max(np.abs(ref), axis=1))
    r = np.zeros_like(d)
    ok = b > 0
    r[ok] = d[ok] / b[ok]
    r[~ok] = np.where(d[~ok] > 0, np.inf, 0.0)
    return d, b, r


E = load.EXPORT
v3j = json.load(open(E / f"l3sc-v3-{CELL}.json", encoding="utf-8"))
v3 = np.fromfile(E / f"l3sc-v3-{CELL}.bin", dtype=np.float64).reshape(-1, 3)
pre = np.fromfile(E / f"l3sc-v3-{CELL}-pre.bin", dtype=np.float64).reshape(-1, 3)
ref = np.fromfile(E / f"l3sc-ref-{CELL}-pairs.bin", dtype=np.int32).reshape(-1, 2)
refj = json.load(open(E / f"l3sc-ref-{CELL}.json", encoding="utf-8"))

out = {"what": "v4-14 §1-①② 판정", "cell": CELL, "arch": ARCH,
       "K_depth": K_DEPTH, "K_ops": K_OPS,
       "캐스팅만_최대성분차m": float(np.abs(pre.astype(np.float32).astype(np.float64) - pre).max()),
       "층1": {}, "쌍집합": {}}

for fpn, ua in (("f64", ulp_f64_arr), ("f32", ulp_f32_arr)):
    for order in ("v3", "nat"):
        f = E / f"l3sc-v4-{CELL}-{fpn}-{ARCH}-{order}.bin"
        if not f.exists():
            continue
        a = np.fromfile(f, dtype=np.float64).reshape(-1, 3)
        d, b, r = layer1(a - v3, v3, K_DEPTH, ua)
        out["층1"][f"{fpn}-{order}"] = {
            "최대_성분차m": float(d.max()), "중앙_성분차m": float(np.median(d)),
            "상한m(최대자리)": float(b.max()), "비_최대": float(np.nanmax(r)),
            "초과_정점수": int((r > 1).sum()), "정점수": int(d.shape[0]),
            "통과": bool((r <= 1).all()),
        }
    fa = E / f"l3sc-v4-{CELL}-{fpn}-{ARCH}-v3.bin"
    fb = E / f"l3sc-v4-{CELL}-{fpn}-{ARCH}-nat.bin"
    if fa.exists() and fb.exists():
        A = np.fromfile(fa, dtype=np.float64).reshape(-1, 3)
        B = np.fromfile(fb, dtype=np.float64).reshape(-1, 3)
        out["층1"][f"{fpn}-순서차(v3↔자연)_최대성분차m"] = float(np.abs(A - B).max())

    pf = E / f"l3sc-v4-{CELL}-{fpn}-{ARCH}-pairs.bin"
    if pf.exists():
        g = np.fromfile(pf, dtype=np.int32).reshape(-1, 2)
        gs = set(map(tuple, g.tolist()))
        rs = set(map(tuple, ref.tolist()))
        dg = sorted(gs - rs)[:20]
        dr = sorted(rs - gs)[:20]
        out["쌍집합"][fpn] = {
            "GPU": len(gs), "R(격자없는 정본)": len(rs), "v3_selfStats[0]": v3j["근접쌍"],
            "R == v3 개수": refj["일치"],
            "차집합 GPU−R": len(gs - rs), "차집합 R−GPU": len(rs - gs),
            "완전일치": gs == rs, "예시 GPU−R": dg, "예시 R−GPU": dr,
        }

out["v3"] = {k: v3j[k] for k in ("근접쌍", "해소횟수", "최대침투m", "움직인정점", "최대변위m", "T", "n")}
json.dump(out, open(E / f"l3sc-cmp-{CELL}-{ARCH}.json", "w", encoding="utf-8"),
          indent=1, ensure_ascii=False)
print(json.dumps(out, ensure_ascii=False, indent=1))
