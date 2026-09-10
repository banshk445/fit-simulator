"""v4-12 §1-③ㄱ — **병렬 확인(실행 «전»)**. `full_par.FullPar.substep_par` 가 «정말» 병렬 태스크로
쪼개졌는지를 **세서** 확인한다(함정 42 규범 ① — 소스의 for 문 수는 계기가 아니다).

```
 세 조건(회차 프롬프트 ③ㄱ · 셋 다 성립해야 ㄴ 착수) —
   ㉠ 프로파일러 태스크 수(레코드/호출) == 코드에서 «센» 수(§0-4ㄹ = 29)
   ㉡ 색 루프 태스크의 grid/block > 1
   ㉢ IR 에 `range_for` 존재  ← `ir` 모드(`print_ir=True`)
 대조군(함정 42 규범 ③) — 같은 데이터로 `full_color2.FullColor2.substep` 도 같이 잰다.
   그쪽은 v4-11 실측대로 **6개**여야 한다(그래야 이 계기가 「29」를 그냥 찍는 게 아님이 보인다).
```
★ 물리 0~수 서브스텝 · `engine/full.py` 바이트 불변 · 산출 파일 0(표준출력만).
진입: `py gpu/par_probe.py [tasks|ir]`
"""
import collections
import sys
from pathlib import Path

import numpy as np
import taichi as ti

sys.path.insert(0, str(Path(__file__).resolve().parent))
from oracle import load  # noqa: E402
from engine import full_par as FP, full_color2 as FC2, collide as CO, seam as SE  # noqa: E402

MODE = sys.argv[1] if len(sys.argv) > 1 else "tasks"
CELL, BODY = "c100-h170-s45_M", "c100-h170-s45"
npfp, fp = np.float32, ti.f32

hs, invm, ip_idx, ip_par = load.scene(CELL)
hb, bd_idx, bd_par = load.scene_bend(CELL)
hm, sm_idx, sm_rest = SE.load_seam(load.EXPORT / f"scene-seam-{CELL}.bin")
sh, sdata = CO.load_sdf(load.EXPORT / f"sdf-{BODY}.bin")
n = hs["n"]
head, st, _ = load.cloth(CELL)
pos0 = st[: n * 3].reshape(n, 3).astype(npfp)
vel0 = st[n * 3:].reshape(n, 3).astype(npfp)

ti.init(arch=ti.cuda, default_fp=fp, kernel_profiler=(MODE == "tasks"), print_ir=(MODE == "ir"))
assert ti.lang.impl.current_cfg().arch == ti.cuda, "조용한 arch 폴백(v4-01 함정 1)"


def build(cls):
    return cls(pos0, vel0, invm.astype(npfp),
               ip_idx, ip_par.astype(npfp), hs["k"], bd_idx, bd_par.astype(npfp), hb["ke"],
               sm_idx, sm_rest.astype(npfp), sh, sdata, sh["THICK"], sh["MU"], fp=fp)


DT, G, DAMP, SUB = 1 / 60, 9.81, 6.0, hs["substeps"]
h = DT / SUB
h2 = h * h
decay = float(np.exp(-DAMP * h))

if MODE == "ir":
    fu = build(FP.FullPar)
    print(f"=== [v4-12] full_par.FullPar.substep_par 컴파일 시작 · 색 {fu.ip_colors}/{fu.bd_colors} "
          f"· 코드에서 센 태스크 {fu.n_tasks_expected()} ===", flush=True)
    fu.substep_par(h, h2, G, decay, fu.k, fu.ke)
    ti.sync()
    print("=== [v4-12] 컴파일 끝 ===", flush=True)
    sys.exit(0)

prof = ti.profiler.kernel_profiler.get_default_kernel_profiler()
CALLS = 5


def measure(cls, label, call):
    fu = build(cls)
    call(fu)                                    # 예열(JIT)
    ti.sync()
    ti.profiler.clear_kernel_profiler_info()
    for _ in range(CALLS):
        call(fu)
    ti.sync()
    prof.get_total_time()                       # ← `_traced_records` 를 채운다(v4-11 §2-4)
    cnt, tot, grid, blk = collections.Counter(), collections.defaultdict(float), {}, {}
    for r in prof._traced_records:
        cnt[r.name] += 1
        tot[r.name] += r.kernel_time
        grid[r.name], blk[r.name] = r.grid_size, r.block_size
    phys = {k: v for k, v in cnt.items() if "substep" in k}
    tasks = sum(phys.values()) / CALLS
    exp = fu.n_tasks_expected() if hasattr(fu, "n_tasks_expected") else None
    print(f"\n── {label} — 색 {fu.ip_colors}/{fu.bd_colors} · 호출 {CALLS}회 · "
          f"태스크/호출 **{tasks:.2f}** · 코드에서 센 수 {exp} · 종류 {len(phys)}")
    par = ser = 0
    for name in sorted(phys, key=lambda k: -tot[k]):
        kind = "range_for" if "range_for" in name else ("serial" if "serial" in name else "?")
        if kind == "range_for":
            par += 1
        elif kind == "serial":
            ser += 1
        print(f"   {name:<52} {phys[name]//CALLS:>3}/호출 grid {grid[name]:>4} block {blk[name]:>4} "
              f"누적 {tot[name]:9.3f} ms  [{kind}]")
    print(f"   ⟹ range_for 태스크 {par}종 · serial 태스크 {ser}종 · "
          f"grid>1 인 태스크 {sum(1 for k in phys if grid[k] > 1)}종")
    return tasks, exp


print(f"[par_probe] n {n} · substeps {SUB} · arch {ti.lang.impl.current_cfg().arch} · "
      f"프로파일러 {prof.get_kernel_profiler_mode()}", flush=True)
t_par, e_par = measure(FP.FullPar, "full_par.FullPar.substep_par (이 판 신설)",
                       lambda fu: fu.substep_par(h, h2, G, decay, fu.k, fu.ke))
t_c2, _ = measure(FC2.FullColor2, "full_color2.FullColor2.substep (대조군 · v4-11 실측 6)",
                  lambda fu: fu.substep(h, h2, G, decay, fu.k, fu.ke, 1, 1, 1, 1))
print(f"\n[③ㄱ 판정 재료] 신설판 태스크/호출 {t_par:.2f} (코드 {e_par}) · "
      f"대조군 {t_c2:.2f} (v4-11 실측 6.00)")
