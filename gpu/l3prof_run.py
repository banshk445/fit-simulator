"""v4-11 §1-④ — **비용 분해**. 60프레임 실행에서 «커널 실행 횟수»와 «커널별 누적 시간»을 재고,
**커널 실행(launch) 오버헤드 추정치**를 같은 프로세스에서 따로 잰다.

```
 계기(§0-4ㄷ · 값을 보기 «전»에 등재) —
   `ti.init(kernel_profiler=True)` + `taichi.profiler.kernel_profiler` 의 traced record
   (레코드 이름이 **`…_serial` / `…_range_for`** 로 태스크 종류를 스스로 밝힌다 ·
    `grid_size` · `block_size` 도 레코드에 있다).
   커널 «횟수»는 ㉠ 프로파일러 레코드 수 ㉡ 코드에서 센 수 **둘 다** 적는다.
   **오버헤드 추정치** = 같은 프로세스에서 «거의 빈» 커널을 10만 회 띄운 벽시계 / 횟수.
 ★ 프로파일러가 시간을 바꿀 수 있으므로 **v4-10 의 비프로파일 벽시계와 나란히** 적는다(§0-4ㄹ).
```

★ `engine/` 바이트 불변 · 물리 식 0줄 · `src/` diff 0.
진입: `py gpu/l3prof_run.py [serial|color] [frames]`
"""
import collections
import json
import sys
import time
from pathlib import Path

import numpy as np
import taichi as ti

sys.path.insert(0, str(Path(__file__).resolve().parent))
from oracle import load  # noqa: E402
from engine import full as F, full_color2 as FC2, collide as CO, seam as SE  # noqa: E402

MODE = sys.argv[1] if len(sys.argv) > 1 else "serial"
FRAMES = int(sys.argv[2]) if len(sys.argv) > 2 else 60
assert MODE in ("serial", "color")
CELL, BODY, FPN = "c100-h170-s45_M", "c100-h170-s45", "f32"
fp, npfp = ti.f32, np.float32
FLAGS = dict(use_ip=1, use_bd=1, use_sm=1, use_col=1)

hs, invm, ip_idx, ip_par = load.scene(CELL)
hb, bd_idx, bd_par = load.scene_bend(CELL)
hm, sm_idx, sm_rest = SE.load_seam(load.EXPORT / f"scene-seam-{CELL}.bin")
sh, sdata = CO.load_sdf(load.EXPORT / f"sdf-{BODY}.bin")
n = hs["n"]
head, st, _ = load.cloth(CELL)
pos0 = st[: n * 3].reshape(n, 3).astype(npfp)
vel0 = st[n * 3:].reshape(n, 3).astype(npfp)

t_init = time.perf_counter()
ti.init(arch=ti.cuda, default_fp=fp, kernel_profiler=True)
arch = str(ti.lang.impl.current_cfg().arch)
assert ti.lang.impl.current_cfg().arch == ti.cuda, "조용한 arch 폴백(v4-01 함정 1)"
cls = F.Full if MODE == "serial" else FC2.FullColor2
fu = cls(pos0, vel0, invm.astype(npfp),
         ip_idx, ip_par.astype(npfp), hs["k"], bd_idx, bd_par.astype(npfp), hb["ke"],
         sm_idx, sm_rest.astype(npfp), sh, sdata, sh["THICK"], sh["MU"], fp=fp)
init_s = time.perf_counter() - t_init

DT, G, DAMP, SUB, N_WIN = 1 / 60, 9.81, 6.0, hs["substeps"], 10
prof = ti.profiler.kernel_profiler.get_default_kernel_profiler()
tops = (1 if MODE == "serial" else 4 + fu.ip_colors + fu.bd_colors + 3)
print(f"[시작 {time.strftime('%Y-%m-%d %H:%M:%S')}] 비용분해 {MODE} · n {n} · substeps {SUB} · "
      f"프레임 {FRAMES} · 최상위 루프/서브스텝 {tops} · arch {arch} · "
      f"프로파일러 모드 {prof.get_kernel_profiler_mode()} · 초기화 {init_s:.1f}s", flush=True)

# ── JIT 을 계측 밖으로 뺀다 — 1프레임 예열 후 프로파일러를 비운다 ────────────
t_jit = time.perf_counter()
fu.step(1, SUB, DT, G, DAMP, **FLAGS)
ti.sync()
jit_s = time.perf_counter() - t_jit
fu.pos.from_numpy(np.ascontiguousarray(pos0, dtype=npfp))
fu.vel.from_numpy(np.ascontiguousarray(vel0, dtype=npfp))
ti.sync()
ti.profiler.clear_kernel_profiler_info()
print(f"  예열(JIT 포함 1프레임) {jit_s:.1f}s · 프로파일러 비움", flush=True)

ref = fu.pos.to_numpy().astype(np.float64)
trail, wall, frame = [], [], 0
t0 = time.perf_counter()
while frame < FRAMES:
    w = min(N_WIN, FRAMES - frame)
    fu.step(w, SUB, DT, G, DAMP, **FLAGS)
    p = fu.pos.to_numpy().astype(np.float64)
    frame += w
    net = float(np.linalg.norm(p - ref, axis=1).max())
    el = time.perf_counter() - t0
    trail.append((frame, net))
    wall.append((frame, el))
    print(f"  f={frame} net={net:.6e} ({el:.0f}s · {el/frame:.3f} s/프레임) "
          f"[{time.strftime('%H:%M:%S')}]", flush=True)
    ref = p
el = time.perf_counter() - t0

# ── 레코드 집계 ────────────────────────────────────────────────────────────
# ★ `_traced_records` 는 `_update_records()` 를 부르기 «전»에는 비어 있다
#   (`get_total_time()` 이 그것을 부른다). 1차 실행에서 이걸 빠뜨려 레코드 0 이 나왔다 — §2-4 등재.
prof_total_s = prof.get_total_time()
recs = prof._traced_records
cnt, tot, grid, blk = collections.Counter(), collections.defaultdict(float), {}, {}
for r in recs:
    cnt[r.name] += 1
    tot[r.name] += r.kernel_time          # ms
    grid[r.name], blk[r.name] = r.grid_size, r.block_size
total_kernel_ms = sum(tot.values())
rows = sorted(tot.items(), key=lambda kv: -kv[1])
# ★ `launches` 는 «여기서» 센다 — 아래 마이크로벤치의 `clear_kernel_profiler_info()` 가
#   `recs` 가 가리키던 버퍼까지 비운다(1차 실행에서 `launches` 가 0 으로 찍혔다 · §2-4ㄹ).
launches = sum(cnt.values())

# ── 오버헤드 추정 — 「거의 빈」 커널을 «같은 프로세스»에서 반복 launch ──────
#   ★ 태스크 수는 «세서» 확인한다(프로파일러 레코드 수 / 호출 수) — 손으로 세지 않는다.
NL = 100000
dummy = ti.field(ti.i32, shape=32)


@ti.kernel
def tiny_serial():
    ti.loop_config(serialize=True)
    for _ in range(1):
        dummy[0] += 1


@ti.kernel
def tiny_par():
    for i in range(1):
        dummy[1] += i + 1


@ti.kernel
def tiny29():
    for i in range(1):
        dummy[2] += i + 2
    for i in range(1):
        dummy[3] += i + 3
    for i in range(1):
        dummy[4] += i + 4
    for i in range(1):
        dummy[5] += i + 5
    for i in range(1):
        dummy[6] += i + 6
    for i in range(1):
        dummy[7] += i + 7
    for i in range(1):
        dummy[8] += i + 8
    for i in range(1):
        dummy[9] += i + 9
    for i in range(1):
        dummy[10] += i + 10
    for i in range(1):
        dummy[11] += i + 11
    for i in range(1):
        dummy[12] += i + 12
    for i in range(1):
        dummy[13] += i + 13
    for i in range(1):
        dummy[14] += i + 14
    for i in range(1):
        dummy[15] += i + 15
    for i in range(1):
        dummy[16] += i + 16
    for i in range(1):
        dummy[17] += i + 17
    for i in range(1):
        dummy[18] += i + 18
    for i in range(1):
        dummy[19] += i + 19
    for i in range(1):
        dummy[20] += i + 20
    for i in range(1):
        dummy[21] += i + 21
    for i in range(1):
        dummy[22] += i + 22
    for i in range(1):
        dummy[23] += i + 23
    for i in range(1):
        dummy[24] += i + 24
    for i in range(1):
        dummy[25] += i + 25
    for i in range(1):
        dummy[26] += i + 26
    for i in range(1):
        dummy[27] += i + 27
    for i in range(1):
        dummy[28] += i + 28
    for i in range(1):
        dummy[29] += i + 29
    for i in range(1):
        dummy[30] += i + 30


tiny_serial()
tiny_par()
tiny29()
ti.sync()
ti.profiler.clear_kernel_profiler_info()
lat, tasks_per_call = {}, {}
for nm, kk, rep in (("serial", tiny_serial, NL), ("range_for", tiny_par, NL),
                    ("29tasks", tiny29, NL // 5)):
    ti.profiler.clear_kernel_profiler_info()
    tl = time.perf_counter()
    for _ in range(rep):
        kk()
    ti.sync()
    lat[nm] = (time.perf_counter() - tl) / rep
    prof.get_total_time()
    tasks_per_call[nm] = len(prof._traced_records) / rep

py_calls = (FRAMES // N_WIN) if MODE == "serial" else FRAMES * SUB
shape_lat = lat["serial"] if MODE == "serial" else lat["29tasks"]
est_launch_s = py_calls * shape_lat               # 추정 A — 파이썬 커널 «호출» 수 × 같은 모양의 지연
est_task_s = launches * lat["range_for"]          # 추정 B — offloaded «태스크» 수 × 1태스크 커널 지연
res = {
    "mode": MODE, "cell": CELL, "fp": FPN, "n": n, "substeps": SUB, "frames": FRAMES,
    "arch": arch, "initSec": init_s, "warmupSec": jit_s,
    "wallSec": el, "secPerFrame": el / FRAMES, "trail": trail, "wall": wall,
    "topLevelLoopsPerSubstep": tops,
    "launchesProfiler": launches,
    "launchesFromCode": ((FRAMES // N_WIN) if MODE == "serial" else tops * SUB * FRAMES),
    "launchesFromCodeNote": ("직렬 = step() 호출당 커널 1개(창 6회)" if MODE == "serial"
                             else "색분할 = 최상위 루프 %d × 서브스텝 %d × 프레임 %d" % (tops, SUB, FRAMES)),
    "pyKernelCalls": py_calls,
    "profilerTotalSec": prof_total_s,
    "kernelMsTotal": total_kernel_ms,
    "kernelSecTotal": total_kernel_ms / 1e3,
    "kernelShareOfWall": (total_kernel_ms / 1e3) / el,
    "perKernel": [{"name": k, "count": cnt[k], "totalMs": v, "avgMs": v / cnt[k],
                   "grid": grid[k], "block": blk[k]} for k, v in rows],
    "launchLatencySec": lat, "tasksPerCall": tasks_per_call,
    "shapeLatencySec": shape_lat,
    "estLaunchOverheadSec": est_launch_s, "estLaunchShareOfWall": est_launch_s / el,
    "estTaskOverheadSec": est_task_s, "estTaskShareOfWall": est_task_s / el,
}
out = load.EXPORT / f"l3prof-{CELL}-{MODE}-{FPN}-f{FRAMES}"
json.dump(res, open(str(out) + ".json", "w", encoding="utf-8"), indent=1, ensure_ascii=False)
fu.pos.to_numpy().astype(np.float64).tofile(str(out) + ".bin")

print(f"\n[{MODE}] 벽시계 {el:.1f}s ({el/FRAMES:.3f} s/프레임) · 커널 누적 "
      f"{total_kernel_ms/1e3:.1f}s ({res['kernelShareOfWall']*100:.2f}% of 벽시계) · "
      f"프로파일러 총시간 {prof_total_s:.1f}s")
print(f"  launch 프로파일러 {launches} · 코드 {res['launchesFromCode']} · 파이썬 커널 호출 {py_calls}")
print(f"  launch 지연 — serial {lat['serial']*1e6:.1f}us(태스크/호출 {tasks_per_call['serial']:.2f}) · "
      f"range_for {lat['range_for']*1e6:.1f}us({tasks_per_call['range_for']:.2f}) · "
      f"29태스크 {lat['29tasks']*1e6:.1f}us({tasks_per_call['29tasks']:.2f})")
print(f"  추정 A(호출×모양지연) {est_launch_s:.1f}s = {res['estLaunchShareOfWall']*100:.2f}% · "
      f"추정 B(태스크×1태스크지연) {est_task_s:.1f}s = {res['estTaskShareOfWall']*100:.2f}%")
print("| 태스크 | 횟수 | 누적 ms | 평균 ms | grid | block |")
print("|---|---|---|---|---|---|")
for k, v in rows[:24]:
    print(f"| `{k}` | {cnt[k]} | {v:.1f} | {v/cnt[k]:.4f} | {grid[k]} | {blk[k]} |")
print(f"  → {out}.json")
