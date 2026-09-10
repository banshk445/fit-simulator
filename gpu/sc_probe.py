"""v4-14 §2 — **전 정의역 결합 솔버의 병렬 확인**. `par_probe2.py` 와 «같은 계기»이되
`FullSC`(= `substep_a` + 셀프 충돌 + `substep_b`)를 잰다(v4-12/13 파일은 바이트 불변 · 새 파일).

세는 것도 같다 — 프로파일러 태스크/호출 · grid/block · range_for/serial 종수.
★ 물리 1서브스텝 · `engine/` 기존 8파일 바이트 불변 · 산출 파일 0(표준출력만).
진입: `py gpu/sc_probe.py <cuda|x64> <f64|f32>`
"""
import collections
import sys
from pathlib import Path

import numpy as np
import taichi as ti

sys.path.insert(0, str(Path(__file__).resolve().parent))
from oracle import load  # noqa: E402
from engine import full_sc as FS, collide as CO, seam as SE  # noqa: E402

ARCH = sys.argv[1] if len(sys.argv) > 1 else "cuda"
FPN = sys.argv[2] if len(sys.argv) > 2 else "f64"
ARCH_T = {"cuda": ti.cuda, "x64": ti.x64, "arm64": ti.arm64}[ARCH]
fp, npfp = ({"f32": (ti.f32, np.float32), "f64": (ti.f64, np.float64)})[FPN]
CELL, BODY = "c100-h170-s45_M", "c100-h170-s45"

tris = np.fromfile(load.EXPORT / f"l3sc-v3-{CELL}-tris.bin", dtype=np.int32).reshape(-1, 3)
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
fu = FS.FullSC(pos0, vel0, invm.astype(npfp),
               ip_idx, ip_par.astype(npfp), hs["k"], bd_idx, bd_par.astype(npfp), hb["ke"],
               sm_idx, sm_rest.astype(npfp), sh, sdata, sh["THICK"], sh["MU"], fp=fp, tris=tris)
DT, G, DAMP, SUB = 1 / 60, 9.81, 6.0, hs["substeps"]
h, decay = DT / SUB, float(np.exp(-DAMP * DT / SUB))
h2 = h * h
CALLS = 3


def one():
    fu.substep_a(h, h2, G, fu.k, fu.ke)
    fu.sc.apply(order="v3")
    fu.substep_b(h, decay)


prof = ti.profiler.kernel_profiler.get_default_kernel_profiler()
one()                                   # 예열(JIT)
ti.sync()
ti.profiler.clear_kernel_profiler_info()
for _ in range(CALLS):
    one()
ti.sync()
prof.get_total_time()
cnt, tot, grid, blk = collections.Counter(), collections.defaultdict(float), {}, {}
for r in prof._traced_records:
    cnt[r.name] += 1
    tot[r.name] += r.kernel_time
    grid[r.name], blk[r.name] = r.grid_size, r.block_size
sub = {k: v for k, v in cnt.items() if "substep" in k}
sc = {k: v for k, v in cnt.items() if k not in sub}
print(f"[sc_probe] arch {ti.lang.impl.current_cfg().arch} · fp {FPN} · n {n} · T {tris.shape[0]} · "
      f"색 {fu.ip_colors}/{fu.bd_colors} · 서브스텝 {CALLS}회")
print(f"  substep_a+b 태스크/호출 **{sum(sub.values())/CALLS:.2f}** · 코드에서 «센» 수 "
      f"{fu.n_tasks_expected()} · 종류 {len(sub)}")
print(f"  셀프 충돌 태스크/호출 **{sum(sc.values())/CALLS:.2f}** · 종류 {len(sc)}")
for tag, grp in (("substep", sub), ("selfcol", sc)):
    par = sum(1 for k in grp if "range_for" in k)
    ser = sum(1 for k in grp if "serial" in k)
    gs = [grid[k] for k in grp if "range_for" in k]
    print(f"  [{tag}] range_for {par}종 · serial {ser}종 · grid>1 {sum(1 for k in grp if grid[k] > 1)}종 · "
          f"grid {min(gs) if gs else 0}~{max(gs) if gs else 0} · "
          f"block {sorted({blk[k] for k in grp if 'range_for' in k})}")
for name in sorted(sc, key=lambda k: -tot[k])[:8]:
    print(f"   {name:<48} {sc[name]//CALLS:>3}/호출 grid {grid[name]:>6} block {blk[name]:>4} "
          f"누적 {tot[name]:9.3f} ms")
