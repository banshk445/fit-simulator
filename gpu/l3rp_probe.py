"""v4-16 §1-②ㄱㄴ — **색 분할 해소의 확인**(실행 «전»). 물리 1서브스텝 · 산출은 표준출력 + JSON.

```
 ㄱ 색 수 · 색별 접촉 수 · **같은 색 안 정점 공유 0**(기계검증 · O(N²) 전수)
 ㄴ 태스크/grid/block 실측(함정 42 — `if` 밖 최상위 `range_for` 인지 «세서» 본다) ·
    대조군 = 직렬 해소판(같은 판에서 같이 잰다 ⟹ 계기가 살아 있음이 보인다)
 ㄷ(보조) 같은 초기 상태에서 **직렬 해소 ↔ 색 해소**의 위치 차 — 「색 사이에서 접히는 순서」의 크기
```
진입: `py gpu/l3rp_probe.py [cell] [rounds]`
"""
import collections
import json
import sys
from pathlib import Path

import numpy as np
import taichi as ti

sys.path.insert(0, str(Path(__file__).resolve().parent))
from oracle import load  # noqa: E402
from engine import full_sc as FS, full_sc_col as FSC, collide as CO, seam as SE  # noqa: E402

CELL = sys.argv[1] if len(sys.argv) > 1 else "c100-h170-s45_M"
ROUNDS = int(sys.argv[2]) if len(sys.argv) > 2 else 32
BODY = CELL.rsplit("_", 1)[0]
fp, npfp = ti.f64, np.float64

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
args = (pos0, vel0, invm.astype(npfp), ip_idx, ip_par.astype(npfp), hs["k"],
        bd_idx, bd_par.astype(npfp), hb["ke"], sm_idx, sm_rest.astype(npfp),
        sh, sdata, sh["THICK"], sh["MU"])
ser = FS.FullSC(*args, fp=fp, tris=tris)
col = FSC.FullSCColored(*args, fp=fp, tris=tris, rounds=ROUNDS)
DT, G, DAMP, SUB = 1 / 60, 9.81, 6.0, hs["substeps"]
h, decay = DT / SUB, float(np.exp(-DAMP * DT / SUB))
h2 = h * h


def one(fu):
    fu.pos.from_numpy(np.ascontiguousarray(pos0, dtype=npfp))
    fu.vel.from_numpy(np.ascontiguousarray(vel0, dtype=npfp))
    ti.sync()
    fu.substep_a(h, h2, G, fu.k, fu.ke)
    stt = fu.sc.apply(order="v3")
    fu.substep_b(h, decay)
    ti.sync()
    return stt, fu.pos.to_numpy().astype(np.float64)


col.sc.left[None] = 0
col.sc.ncolor[None] = 0
col.sc.shared[None] = 0
s_ser, p_ser = one(ser)
s_col, p_col = one(col)
col.sc._check_shared()
cst = col.sc.color_stats()
ncon = int(col.sc.ncon[None])
cols = col.sc.color.to_numpy()[:ncon]
sizes = np.bincount(cols[cols >= 0], minlength=max(cst["ncolor"], 1)).tolist()

ti.profiler.clear_kernel_profiler_info()
for _ in range(3):
    one(ser)
ti.sync()
prof = ti.profiler.kernel_profiler.get_default_kernel_profiler()
prof.get_total_time()
rec_s = collections.defaultdict(float)
gs, bs = {}, {}
cnt_s = collections.Counter()
for r in prof._traced_records:
    rec_s[r.name] += r.kernel_time
    cnt_s[r.name] += 1
    gs[r.name], bs[r.name] = r.grid_size, r.block_size
ti.profiler.clear_kernel_profiler_info()
for _ in range(3):
    one(col)
ti.sync()
prof.get_total_time()
rec_c = collections.defaultdict(float)
cnt_c = collections.Counter()
gc, bc = {}, {}
for r in prof._traced_records:
    rec_c[r.name] += r.kernel_time
    cnt_c[r.name] += 1
    gc[r.name], bc[r.name] = r.grid_size, r.block_size


def pick(rec, cnt, g, b, pat):
    ks = [k for k in rec if pat in k]
    return [{"커널": k, "ms_서브스텝당": round(rec[k] / 3, 4), "호출_서브스텝당": cnt[k] // 3,
             "grid": g[k], "block": b[k],
             "kind": "range_for" if "range_for" in k else ("serial" if "serial" in k else "?")}
            for k in sorted(ks, key=lambda x: -rec[x])]


d = np.abs(p_ser - p_col)
out = {"what": "v4-16 §1-②ㄱㄴ 색 분할 해소 확인", "cell": CELL, "n": n, "substeps": SUB,
       "rounds_상한": ROUNDS,
       "ㄱ": {"접촉": ncon, "색 수": cst["ncolor"], "색을 못 받은 접촉(left)": cst["left"],
             "같은 색 안 정점 공유(전수 검사)": cst["shared"], "색별 접촉 수": sizes},
       "ㄴ": {"직렬 해소": pick(rec_s, cnt_s, gs, bs, "_resolve"),
             "색 라운드(청구·승자·해소 한 커널)": pick(rec_c, cnt_c, gc, bc, "_round"),
             "직렬판 셀프충돌 총 ms/서브스텝": round(sum(v for k, v in rec_s.items() if "substep" not in k) / 3, 4),
             "색판 셀프충돌 총 ms/서브스텝": round(sum(v for k, v in rec_c.items() if "substep" not in k) / 3, 4)},
       "ㄷ": {"해소 횟수 직렬": s_ser["applied"], "해소 횟수 색": s_col["applied"],
             "접촉 직렬": s_ser["cons"], "접촉 색": s_col["cons"], "쌍": s_ser["pairs"],
             "1서브스텝 위치차 최대 성분(m)": float(d.max()),
             "1서브스텝 위치차 중앙 성분(m)": float(np.median(d))}}
json.dump(out, open(load.EXPORT / f"l3rp-probe-{CELL}.json", "w", encoding="utf-8"),
          indent=1, ensure_ascii=False)
print(json.dumps(out, ensure_ascii=False, indent=1))
