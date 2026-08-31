"""v4-12 §1-② — **발산 시작점 주사**의 v4 쪽 + 대조표.

v3(f64·Node · `scripts/v4FrameDump.ts`)와 v4(f32·CUDA · `engine/full.py`)를 **같은 초기 상태**에서
각각 10프레임 돌려 **프레임마다** 좌표차를 낸다. v3 쪽 덤프는 미리 만들어 둔 `l3fd-v3-<CELL>.bin` 을 읽는다.

```
 대조의 정의(§0-4ㄷ · 값을 보기 «전»에 등재) —
   ㉠ 최대 좌표차 = max |Δ성분| (mm)   ㉡ 최대 정점 거리 (mm)   ㉢ **중앙** 정점 거리 (mm)
   **f=0 도 인쇄한다** — f32 캐스팅만 한 차이이고, 이것이 「ULP 급」의 «척도»다.
   (가)/(나) = f=1 의 최대 좌표차 ≤ 10 × f=0 의 최대 좌표차 이면 (가).
 참고 상수(계기 아님): f32 ULP(1.0 m) = 2^-23 = 1.192e-07 m = 1.192e-04 mm
```
★ `engine/full.py` 바이트 불변 · 물리 식 0줄.
진입: `py gpu/l3fd_run.py [frames]`
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

CELL, BODY, FPN = "c100-h170-s45_M", "c100-h170-s45", "f32"
FRAMES = int(sys.argv[1]) if len(sys.argv) > 1 else 10
fp, npfp = ti.f32, np.float32
FLAGS = dict(use_ip=1, use_bd=1, use_sm=1, use_col=1)

hs, invm, ip_idx, ip_par = load.scene(CELL)
hb, bd_idx, bd_par = load.scene_bend(CELL)
hm, sm_idx, sm_rest = SE.load_seam(load.EXPORT / f"scene-seam-{CELL}.bin")
sh, sdata = CO.load_sdf(load.EXPORT / f"sdf-{BODY}.bin")
n = hs["n"]
head, st, _ = load.cloth(CELL)
pos0_64 = st[: n * 3].reshape(n, 3).astype(np.float64)     # v3 와 «같은» 원본
vel0_64 = st[n * 3:].reshape(n, 3).astype(np.float64)

# ── v3 덤프 읽기 ──────────────────────────────────────────────────────────
v3p = load.EXPORT / f"l3fd-v3-{CELL}.bin"
raw = np.fromfile(v3p, dtype=np.uint8)
hl = int(np.frombuffer(raw[:4].tobytes(), dtype="<u4")[0])
v3h = json.loads(raw[4:4 + hl].tobytes().decode("utf-8"))
v3 = np.frombuffer(raw[4 + hl:].tobytes(), dtype=np.float64).reshape(-1, n, 3)
assert v3h["n"] == n, f"정점 수 불일치 {v3h['n']} != {n}"
assert v3.shape[0] >= FRAMES + 1, f"v3 덤프 프레임 부족 {v3.shape[0]} < {FRAMES+1}"
assert np.array_equal(v3[0], pos0_64), "v3 f=0 이 정착 blob 원본과 다르다(같은 초기 상태가 아니다)"

ti.init(arch=ti.cuda, default_fp=fp)
arch = str(ti.lang.impl.current_cfg().arch)
assert ti.lang.impl.current_cfg().arch == ti.cuda, "조용한 arch 폴백(v4-01 함정 1)"
fu = F.Full(pos0_64.astype(npfp), vel0_64.astype(npfp), invm.astype(npfp),
            ip_idx, ip_par.astype(npfp), hs["k"], bd_idx, bd_par.astype(npfp), hb["ke"],
            sm_idx, sm_rest.astype(npfp), sh, sdata, sh["THICK"], sh["MU"], fp=fp)

DT, G, DAMP, SUB = 1 / 60, 9.81, 6.0, hs["substeps"]
ULP1 = 2.0 ** -23 * 1e3        # f32 ULP(1.0 m) in mm — 참고 상수(계기 아님)
print(f"[시작 {time.strftime('%Y-%m-%d %H:%M:%S')}] 발산 주사 · n {n} · substeps {SUB} · "
      f"프레임 {FRAMES} · arch {arch} · v3 m {v3h['m']} {v3h['kinds']} · v3 sub {v3h['substeps']}",
      flush=True)
assert v3h["substeps"] == SUB, f"substeps 불일치 v3 {v3h['substeps']} != v4 {SUB}"

rows = []


def row(f, p4):
    d = p4 - v3[f]
    dist = np.linalg.norm(d, axis=1)
    r = dict(frame=f, maxCoordMm=float(np.abs(d).max()) * 1e3,
             maxDistMm=float(dist.max()) * 1e3, medDistMm=float(np.median(dist)) * 1e3,
             p99DistMm=float(np.percentile(dist, 99)) * 1e3, maxAt=int(dist.argmax()))
    rows.append(r)
    print(f"  f={f:<3} 최대좌표차 {r['maxCoordMm']:.6e} mm · 최대거리 {r['maxDistMm']:.6e} mm · "
          f"중앙거리 {r['medDistMm']:.6e} mm · p99 {r['p99DistMm']:.6e} mm · maxAt {r['maxAt']}",
          flush=True)
    return r


row(0, fu.pos.to_numpy().astype(np.float64))
t0 = time.perf_counter()
for f in range(1, FRAMES + 1):
    fu.step(1, SUB, DT, G, DAMP, **FLAGS)
    row(f, fu.pos.to_numpy().astype(np.float64))
el = time.perf_counter() - t0

r0, r1 = rows[0]["maxCoordMm"], rows[1]["maxCoordMm"]
verdict = "(가) ULP 급" if r1 <= 10 * r0 else "(나) ULP 를 크게 넘는다"
ratios = [rows[i + 1]["maxCoordMm"] / rows[i]["maxCoordMm"] for i in range(len(rows) - 1)]
out = load.EXPORT / f"l3fd-cmp-{CELL}-f{FRAMES}"
json.dump({"cell": CELL, "n": n, "substeps": SUB, "arch": arch, "frames": FRAMES,
           "ulp1mMm": ULP1, "rows": rows, "ratios": ratios, "sec": el,
           "f0MaxCoordMm": r0, "f1MaxCoordMm": r1, "f1OverF0": r1 / r0, "verdict": verdict,
           "v3": v3h}, open(str(out) + ".json", "w", encoding="utf-8"), indent=1, ensure_ascii=False)
print(f"[② 판정 재료] f=0 {r0:.6e} mm · f=1 {r1:.6e} mm · 비 {r1/r0:.3f} "
      f"(문턱 10) ⟹ {verdict} · f32 ULP(1m) {ULP1:.6e} mm")
print("  프레임별 배수 " + " ".join(f"{x:.2f}" for x in ratios))
print(f"  v4 {el:.1f}s ({el/FRAMES:.3f} s/프레임) → {out}.json")
