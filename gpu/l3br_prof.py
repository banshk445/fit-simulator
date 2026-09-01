"""v4-15 §1-③ — **해소 커널 비용 분해**(사실만 · 처방 0 · 최적화 0 · 방안 제시 0).

`sc_probe.py`(v4-14)와 같은 계기이되 **분담을 수로 낸다**(§0-5ㅇ 채널 ㉠~㉣):
```
 ㉠ 커널별 누적 시간 «상위 5»
 ㉡ 해소 직렬 커널 — 호출 수 · 평균(ms/호출) · grid/block
 ㉢ 셀프 충돌 전체가 한 서브스텝에서 차지하는 «비율»
 ㉣ `_pairs`(광역)와 `_resolve`(해소)의 분담
```
★ **계기를 켠 시행은 다른 시행이다**(v4-14 §2-2 ★) — 벽시계와 섞지 않는다.
★ 물리 = 서브스텝 CALLS 회 · 산출 = `l3br-prof-<cell>-<fp>.json` · 진입: `py gpu/l3br_prof.py <cell> [fp] [calls]`
"""
import collections
import json
import sys
from pathlib import Path

import numpy as np
import taichi as ti

sys.path.insert(0, str(Path(__file__).resolve().parent))
from oracle import load  # noqa: E402
from engine import full_sc as FS, collide as CO, seam as SE  # noqa: E402

CELL = sys.argv[1] if len(sys.argv) > 1 else "c100-h170-s45_M"
FPN = sys.argv[2] if len(sys.argv) > 2 else "f64"
CALLS = int(sys.argv[3]) if len(sys.argv) > 3 else 10
BODY = CELL.rsplit("_", 1)[0]
fp, npfp = ({"f32": (ti.f32, np.float32), "f64": (ti.f64, np.float64)})[FPN]

hs, invm, ip_idx, ip_par = load.scene(CELL)
hb, bd_idx, bd_par = load.scene_bend(CELL)
hm, sm_idx, sm_rest = SE.load_seam(load.EXPORT / f"scene-seam-{CELL}.bin")
sh, sdata = CO.load_sdf(load.EXPORT / f"sdf-{BODY}.bin")
n = hs["n"]
head, st, _ = load.cloth(CELL)
pos0 = st[: n * 3].reshape(n, 3).astype(npfp)
vel0 = st[n * 3:].reshape(n, 3).astype(npfp)
tris = np.ascontiguousarray(ip_idx.astype(np.int32))

ti.init(arch=ti.cuda, default_fp=fp, kernel_profiler=True)
assert ti.lang.impl.current_cfg().arch == ti.cuda, "조용한 arch 폴백(v4-01 함정 1)"
fu = FS.FullSC(pos0, vel0, invm.astype(npfp),
               ip_idx, ip_par.astype(npfp), hs["k"], bd_idx, bd_par.astype(npfp), hb["ke"],
               sm_idx, sm_rest.astype(npfp), sh, sdata, sh["THICK"], sh["MU"], fp=fp, tris=tris)
DT, G, DAMP, SUB = 1 / 60, 9.81, 6.0, hs["substeps"]
h, decay = DT / SUB, float(np.exp(-DAMP * DT / SUB))
h2 = h * h


def one():
    fu.substep_a(h, h2, G, fu.k, fu.ke)
    st_ = fu.sc.apply(order="v3")
    fu.substep_b(h, decay)
    return st_


prof = ti.profiler.kernel_profiler.get_default_kernel_profiler()
one()
ti.sync()
ti.profiler.clear_kernel_profiler_info()
acc = collections.Counter()
for _ in range(CALLS):
    s = one()
    for k in ("pairs", "cons", "applied"):
        acc[k] += s[k]
ti.sync()
prof.get_total_time()

cnt, tot, grid, blk = collections.Counter(), collections.defaultdict(float), {}, {}
for r in prof._traced_records:
    cnt[r.name] += 1
    tot[r.name] += r.kernel_time
    grid[r.name], blk[r.name] = r.grid_size, r.block_size
total = sum(tot.values())
sub = {k: v for k, v in tot.items() if "substep_a" in k or "substep_b" in k}
sc = {k: v for k, v in tot.items() if k not in sub}


def group(pat):
    return sum(v for k, v in tot.items() if pat in k)


res_name = next((k for k in tot if "_resolve" in k), None)
rows = [{"커널": k, "ms_누적": round(tot[k], 3), "ms_서브스텝당": round(tot[k] / CALLS, 4),
         "호출": cnt[k] // CALLS, "grid": grid[k], "block": blk[k],
         "비율%": round(100 * tot[k] / total, 2)}
        for k in sorted(tot, key=lambda x: -tot[x])[:5]]
out = {
    "what": "v4-15 §1-③ 해소 커널 비용 분해(사실만 · 처방 0)", "cell": CELL, "fp": FPN,
    "n": n, "T": int(tris.shape[0]), "substeps": SUB, "서브스텝_호출수": CALLS,
    "arch": str(ti.lang.impl.current_cfg().arch),
    "셀프충돌_서브스텝당": {"쌍": acc["pairs"] / CALLS, "접촉": acc["cons"] / CALLS,
                     "해소": acc["applied"] / CALLS},
    "㉠ 상위5": rows,
    "㉡ 해소 직렬 커널": ({"이름": res_name, "호출_서브스텝당": cnt[res_name] // CALLS,
                    "ms_누적": round(tot[res_name], 3), "ms_서브스텝당": round(tot[res_name] / CALLS, 4),
                    "grid": grid[res_name], "block": blk[res_name],
                    "비율%": round(100 * tot[res_name] / total, 2)} if res_name else None),
    "㉢ 분담%": {"substep_a+b(제약·몸충돌·속도)": round(100 * sum(sub.values()) / total, 2),
              "셀프 충돌 전체": round(100 * sum(sc.values()) / total, 2)},
    "㉣ 셀프 충돌 안 분담%": {
        "_boxes(상자)": round(100 * group("_boxes") / total, 2),
        "_cells(셀범위)": round(100 * group("_cells") / total, 2),
        "_fill(격자적재)": round(100 * group("_fill") / total, 2),
        "_pairs(광역)": round(100 * group("_pairs") / total, 2),
        "_narrow(협역)": round(100 * group("_narrow") / total, 2),
        "_rank(순서)": round(100 * group("_rank") / total, 2),
        "_resolve(해소)": round(100 * group("_resolve") / total, 2),
        "그 밖(스칼라 읽기 등)": round(100 * (sum(sc.values()) - sum(
            group(p) for p in ("_boxes", "_cells", "_fill", "_pairs", "_narrow", "_rank", "_resolve"))) / total, 2),
    },
    "총_커널시간ms": round(total, 3), "ms_서브스텝당": round(total / CALLS, 4),
}
json.dump(out, open(load.EXPORT / f"l3br-prof-{CELL}-{FPN}.json", "w", encoding="utf-8"),
          indent=1, ensure_ascii=False)
print(json.dumps(out, ensure_ascii=False, indent=1))
