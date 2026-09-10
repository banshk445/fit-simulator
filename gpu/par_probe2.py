"""v4-13 §2 — **결합판(f64)의 병렬 확인**. v4-12 `gpu/par_probe.py` 와 «같은 계기»이되
`arch`·`default_fp` 를 인자로 받는다(v4-12 파일은 **바이트 불변** · §0-3 ⟹ 새 파일로 판다).

세는 것도 같다 — 프로파일러 태스크/호출 · grid/block · range_for/serial 종수.
★ 물리 0~수 서브스텝 · `engine/` 바이트 불변 · 산출 파일 0(표준출력만).
진입: `py gpu/par_probe2.py <cuda|x64> <f32|f64>`
"""
import collections
import sys
from pathlib import Path

import numpy as np
import taichi as ti

sys.path.insert(0, str(Path(__file__).resolve().parent))
from oracle import load  # noqa: E402
from engine import full_par as FP, collide as CO, seam as SE  # noqa: E402

ARCH = sys.argv[1] if len(sys.argv) > 1 else "cuda"
FPN = sys.argv[2] if len(sys.argv) > 2 else "f64"
ARCH_T = {"cuda": ti.cuda, "x64": ti.x64}[ARCH]
fp, npfp = ({"f32": (ti.f32, np.float32), "f64": (ti.f64, np.float64)})[FPN]
CELL, BODY = "c100-h170-s45_M", "c100-h170-s45"

hs, invm, ip_idx, ip_par = load.scene(CELL)
hb, bd_idx, bd_par = load.scene_bend(CELL)
hm, sm_idx, sm_rest = SE.load_seam(load.EXPORT / f"scene-seam-{CELL}.bin")
sh, sdata = CO.load_sdf(load.EXPORT / f"sdf-{BODY}.bin")
n = hs["n"]
head, st, _ = load.cloth(CELL)
pos0 = st[: n * 3].reshape(n, 3).astype(npfp)
vel0 = st[n * 3:].reshape(n, 3).astype(npfp)

ti.init(arch=ARCH_T, default_fp=fp, kernel_profiler=True)
assert ti.lang.impl.current_cfg().arch == ARCH_T, "조용한 arch 폴백(v4-01 함정 1)"

DT, G, DAMP, SUB = 1 / 60, 9.81, 6.0, hs["substeps"]
h = DT / SUB
h2 = h * h
decay = float(np.exp(-DAMP * h))
CALLS = 5

fu = FP.FullPar(pos0, vel0, invm.astype(npfp),
                ip_idx, ip_par.astype(npfp), hs["k"], bd_idx, bd_par.astype(npfp), hb["ke"],
                sm_idx, sm_rest.astype(npfp), sh, sdata, sh["THICK"], sh["MU"], fp=fp)
prof = ti.profiler.kernel_profiler.get_default_kernel_profiler()
fu.substep_par(h, h2, G, decay, fu.k, fu.ke)          # 예열(JIT)
ti.sync()
ti.profiler.clear_kernel_profiler_info()
for _ in range(CALLS):
    fu.substep_par(h, h2, G, decay, fu.k, fu.ke)
ti.sync()
prof.get_total_time()                                  # `_traced_records` 를 채운다(v4-11 §2-4)

cnt, tot, grid, blk = collections.Counter(), collections.defaultdict(float), {}, {}
for r in prof._traced_records:
    cnt[r.name] += 1
    tot[r.name] += r.kernel_time
    grid[r.name], blk[r.name] = r.grid_size, r.block_size
phys = {k: v for k, v in cnt.items() if "substep" in k}
tasks = sum(phys.values()) / CALLS
print(f"[par_probe2] arch {ti.lang.impl.current_cfg().arch} · fp {FPN} · n {n} · substeps {SUB} · "
      f"색 {fu.ip_colors}/{fu.bd_colors} · 호출 {CALLS}회")
print(f"  태스크/호출 **{tasks:.2f}** · 코드에서 «센» 수 {fu.n_tasks_expected()} · 종류 {len(phys)}")
par = ser = 0
gmin, gmax = 10**9, 0
for name in sorted(phys, key=lambda k: -tot[k]):
    kind = "range_for" if "range_for" in name else ("serial" if "serial" in name else "?")
    if kind == "range_for":
        par += 1
        gmin, gmax = min(gmin, grid[name]), max(gmax, grid[name])
    elif kind == "serial":
        ser += 1
    print(f"   {name:<52} {phys[name]//CALLS:>3}/호출 grid {grid[name]:>4} block {blk[name]:>4} "
          f"누적 {tot[name]:9.3f} ms  [{kind}]")
print(f"  ⟹ range_for {par}종 · serial {ser}종 · grid>1 인 태스크 "
      f"{sum(1 for k in phys if grid[k] > 1)}종 · range_for grid 범위 {gmin}~{gmax} · "
      f"block {sorted({blk[k] for k in phys if 'range_for' in k})}")
