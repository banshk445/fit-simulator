"""v4-11 §1-② — **「Taichi 가 그 루프를 실제로 직렬화했는가」 기계 검사**(§0-4ㄴ㉢).

물리 0 · `engine/` import 0 · 읽기 전용. 「실행 순서 각인」 커널을 네 모양으로 돌린다:

```
 A 최상위 range-for · serialize 없음            ⟹ 병렬이면 각인이 «흐트러진다»
 B 최상위 range-for · ti.loop_config(serialize=True)
 C full.py:233-234 와 «같은 중첩 모양» — serialize 최상위 1회전 + 안쪽 range
 D 같은 중첩 모양 · serialize «없음»            ⟹ 최상위가 1회전뿐이라 안쪽은 직렬인가
```
각인 = `ord[i] = ti.atomic_add(cnt[None], 1)`. **진짜 직렬일 때만** `ord == [0..N-1]` 이다.

진입: `py gpu/serial_probe.py [N]`
"""
import sys

import numpy as np
import taichi as ti

N = int(sys.argv[1]) if len(sys.argv) > 1 else 100000

ti.init(arch=ti.cuda)
arch = str(ti.lang.impl.current_cfg().arch)
assert ti.lang.impl.current_cfg().arch == ti.cuda, "조용한 arch 폴백(v4-01 함정 1)"

ordf = ti.field(ti.i32, shape=N)
cnt = ti.field(ti.i32, shape=())


@ti.kernel
def kA(n: ti.i32):
    for i in range(n):
        ordf[i] = ti.atomic_add(cnt[None], 1)


@ti.kernel
def kB(n: ti.i32):
    ti.loop_config(serialize=True)
    for i in range(n):
        ordf[i] = ti.atomic_add(cnt[None], 1)


@ti.kernel
def kC(n: ti.i32):
    ti.loop_config(serialize=True)
    for _ in range(1):
        for i in range(n):
            ordf[i] = ti.atomic_add(cnt[None], 1)


@ti.kernel
def kD(n: ti.i32):
    for _ in range(1):
        for i in range(n):
            ordf[i] = ti.atomic_add(cnt[None], 1)


idn = np.arange(N, dtype=np.int32)
print(f"[v4-11 §1-② 순서각인] arch {arch} · N {N}", flush=True)
print("| 모양 | serialize | 각인==[0..N-1] | 일치 정점 수 | 첫 8개 | 판정 |")
print("|---|---|---|---|---|---|")
for name, kern, ser, shape in (("A", kA, "없음", "최상위 range-for"),
                               ("B", kB, "**있음**", "최상위 range-for"),
                               ("C", kC, "**있음**", "full.py:233-234 모양(1회전+안쪽)"),
                               ("D", kD, "없음", "full.py 모양 · serialize 뺌")):
    cnt[None] = 0
    ordf.fill(0)
    kern(N)
    ti.sync()
    a = ordf.to_numpy()
    same = int((a == idn).sum())
    ok = bool(np.array_equal(a, idn))
    print(f"| {name} {shape} | {ser} | {'**✅ 예**' if ok else '**❌ 아니오**'} | "
          f"{same} / {N} | {a[:8].tolist()} | {'직렬' if ok else '**병렬(경쟁 있음)**'} |")
