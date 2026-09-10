"""v4-11 §1-④ 보조 — **「`if` 안의 최상위 루프」가 무엇이 되는가** 기계 검사.

§1-④ 의 프로파일러가 색분할판 `full_color2.substep`(코드상 최상위 루프 29개)에서
**태스크를 6개만** 셌고 그중 하나가 `…_serial`(grid 1 · block 1)이었다. 코드에서 그 6개와
1:1로 맞는 루프는 **`if` 밖에 있는 5개**뿐이다. 그 대응이 «우연이 아닌지»를 두 채널로 센다:

```
 A `for` 가 커널 최상위(=`if` 밖)            ⟹ 태스크 몇 개 · 각인이 흐트러지는가(병렬인가)
 B 같은 `for` 가 `if …:` «안»                ⟹ 태스크 몇 개 · 각인이 [0..N-1] 인가(직렬인가)
 C `if` 안에 «세» 개의 for (색 분할 모양)     ⟹ 태스크 몇 개인가
```
각인 = `ord[i] = ti.atomic_add(cnt[None], 1)` · 태스크 수는 프로파일러 레코드로 **센다**.

★ 물리 0 · `engine/` import 0 · 산출 파일 0(표준출력만).
진입: `py gpu/if_probe.py [N]`
"""
import sys

import numpy as np
import taichi as ti

N = int(sys.argv[1]) if len(sys.argv) > 1 else 100000

ti.init(arch=ti.cuda, kernel_profiler=True)
arch = str(ti.lang.impl.current_cfg().arch)
assert ti.lang.impl.current_cfg().arch == ti.cuda, "조용한 arch 폴백(v4-01 함정 1)"
prof = ti.profiler.kernel_profiler.get_default_kernel_profiler()

ordf = ti.field(ti.i32, shape=N)
cnt = ti.field(ti.i32, shape=())


@ti.kernel
def kA(n: ti.i32):
    for i in range(n):
        ordf[i] = ti.atomic_add(cnt[None], 1)


@ti.kernel
def kB(n: ti.i32, flag: ti.i32):
    if flag != 0:
        for i in range(n):
            ordf[i] = ti.atomic_add(cnt[None], 1)


@ti.kernel
def kC(n: ti.i32, flag: ti.i32):
    if flag != 0:
        for i in range(n // 3):
            ordf[i] = ti.atomic_add(cnt[None], 1)
        for i in range(n // 3, 2 * (n // 3)):
            ordf[i] = ti.atomic_add(cnt[None], 1)
        for i in range(2 * (n // 3), n):
            ordf[i] = ti.atomic_add(cnt[None], 1)


idn = np.arange(N, dtype=np.int32)
print(f"[v4-11 §1-④ 보조 · if 안 최상위 루프] arch {arch} · N {N}", flush=True)
print("| 모양 | 태스크 수/호출 | 태스크 이름 | 각인==[0..N-1] | 일치 수 | 판정 |")
print("|---|---|---|---|---|---|")
for name, call, shape in (
        ("A", lambda: kA(N), "`for` 가 커널 최상위"),
        ("B", lambda: kB(N, 1), "같은 `for` 가 **`if` 안**"),
        ("C", lambda: kC(N, 1), "`if` 안에 **for 3개**(색분할 모양)")):
    call()          # 컴파일
    ti.sync()
    cnt[None] = 0
    ordf.fill(0)
    ti.profiler.clear_kernel_profiler_info()
    call()
    ti.sync()
    prof.get_total_time()
    recs = list(prof._traced_records)
    names = sorted({r.name for r in recs if not r.name.startswith(("snode_", "matrix_", "fill_"))})
    a = ordf.to_numpy()
    same = int((a == idn).sum())
    ok = bool(np.array_equal(a, idn))
    ntask = len([r for r in recs if not r.name.startswith(("snode_", "matrix_", "fill_"))])
    print(f"| {name} {shape} | **{ntask}** | {' · '.join('`'+x.split('_c')[-1]+'`' for x in names)} | "
          f"{'**✅ 예**' if ok else '**❌ 아니오**'} | {same} / {N} | "
          f"{'**직렬**' if ok else '병렬'} |")
