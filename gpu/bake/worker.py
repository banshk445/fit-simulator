"""v4-17 §1-① — **굽기 워커 뼈대**. 한 프로세스가 칸 «목록»을 받아 순서대로 굽는다.

★★ **v4-18 재설계**(전략 세션 v4-17 §4) — v4-17 은 「`ti.init` 한 번 + 칸을 이어 굽기」였는데
실측이 **뒤집었다**: 칸마다 필드 모양이 달라 **재컴파일**되고(JIT 10.1 → **79.2 s**) 앞 칸 자원이
풀리지 않아 s/프레임이 **2.798 → 26.911** 로 무너졌다(총 2.83배 «증가»).
⟹ 이 워커는 **칸마다 «자식 프로세스»를 새로 띄운다**. 부모는 «순서·PAUSE·체크포인트·로그»만 맡는다.

```
 job  = gpu/bake/jobs/<이름>.json  {name, cells:[…], fp, arch, frames?}
 PAUSE= gpu/bake/jobs/PAUSE 가 있으면 **다음 칸을 시작하기 «전»** 기다린다(돌던 칸은 끝까지 간다)
 체크 = gpu/bake/results/<job>/<칸>.done 이 있으면 그 칸을 **건너뛴다**(재개 가능 · 칸 단위)
 산출 = results/<job>/<칸>.bin(위치 f64) · <칸>.json(궤적·시간·셀프충돌 통계) ·
        fit-<칸>.json(층3 리포트) · gate-<칸>.json(게이트) · <칸>.done · log.txt 한 줄
```
★ 물리 식 0줄 — `engine/full_sc.py`(v4-14) 를 그대로 부른다. 실행기 규약은 `gpu/l3br_run.py`(v4-15)와 같다.
★ 층3 리포트·게이트는 **기존 계기를 그대로 부른다**(`scripts/v4FitReport.ts` · `v4ProductGate.ts` · 수정 0).
진입: `py gpu/bake/worker.py gpu/bake/jobs/<이름>.json`
"""
import json
import os
import struct
import subprocess
import sys
import time
from pathlib import Path

import numpy as np
import taichi as ti

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from oracle import load  # noqa: E402
from engine import full_sc as FS, collide as CO, seam as SE  # noqa: E402

CHILD = "--child" in sys.argv
CHILD_CELL = sys.argv[sys.argv.index("--child") + 1] if CHILD else None
JOB = json.load(open(sys.argv[1], encoding="utf-8"))
NAME = JOB["name"]
CELLS = JOB["cells"]
FPN = JOB.get("fp", "f64")
ARCH = JOB.get("arch", "cuda")
OUT = ROOT / "bake" / "results" / NAME
OUT.mkdir(parents=True, exist_ok=True)
PAUSE = ROOT / "bake" / "jobs" / "PAUSE"
LOG = OUT / "log.txt"
fp, npfp = ({"f32": (ti.f32, np.float32), "f64": (ti.f64, np.float64)})[FPN]
ARCH_T = {"cuda": ti.cuda, "x64": ti.x64, "arm64": ti.arm64}[ARCH]
TOL = float(json.load(open(load.EXPORT / "cellconv7-c100-h170-s45_M-all-e0-x0.json",
                           encoding="utf-8"))["tol"])
FLAGS = dict(use_ip=1, use_bd=1, use_sm=1, use_col=1)


def log(msg):
    line = f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] {msg}"
    print(line, flush=True)
    with open(LOG, "a", encoding="utf-8") as f:
        f.write(line + "\n")


t_init = time.perf_counter()
ti.init(arch=ARCH_T, default_fp=fp)                      # 자식 프로세스마다 «한 번»
arch = str(ti.lang.impl.current_cfg().arch)
assert ti.lang.impl.current_cfg().arch == ARCH_T, f"조용한 arch 폴백(v4-01 함정 1) — {arch}"
init_s = time.perf_counter() - t_init


def bake(cell):
    body = cell.rsplit("_", 1)[0]
    raw = (Path("public/v3diag/v3-77") / f"settled-{cell}.bin").read_bytes()
    hl = struct.unpack("<I", raw[:4])[0]
    BH = json.loads(raw[4:4 + hl].decode("utf-8"))
    frames = int(JOB.get("frames") or BH["frame"])
    hs, invm, ip_idx, ip_par = load.scene(cell)
    hb, bd_idx, bd_par = load.scene_bend(cell)
    hm, sm_idx, sm_rest = SE.load_seam(load.EXPORT / f"scene-seam-{cell}.bin")
    sh, sdata = CO.load_sdf(load.EXPORT / f"sdf-{body}.bin")
    n = hs["n"]
    assert n == BH["n"], f"정점 수가 다르다 — blob {BH['n']} ≠ 조립 {n}(옛 조립 칸)"
    head, st, _ = load.cloth(cell)
    pos0 = st[: n * 3].reshape(n, 3).astype(npfp)
    vel0 = st[n * 3:].reshape(n, 3).astype(npfp)
    blob_pos = st[: n * 3].reshape(n, 3).astype(np.float64)
    tris = np.ascontiguousarray(ip_idx.astype(np.int32))
    t0 = time.perf_counter()
    fu = FS.FullSC(pos0, vel0, invm.astype(npfp), ip_idx, ip_par.astype(npfp), hs["k"],
                   bd_idx, bd_par.astype(npfp), hb["ke"], sm_idx, sm_rest.astype(npfp),
                   sh, sdata, sh["THICK"], sh["MU"], fp=fp, tris=tris)
    build_s = time.perf_counter() - t0
    DT, G, DAMP, SUB, N_WIN = 1 / 60, 9.81, 6.0, hs["substeps"], 10
    t_jit = time.perf_counter()
    fu.step(1, SUB, DT, G, DAMP, **FLAGS)                # 예열(JIT) — 벽시계 밖
    jit_s = time.perf_counter() - t_jit
    fu.pos.from_numpy(np.ascontiguousarray(pos0, dtype=npfp))
    fu.vel.from_numpy(np.ascontiguousarray(vel0, dtype=npfp))
    ti.sync()
    ref = fu.pos.to_numpy().astype(np.float64)
    trail, frame, deg = [], 0, 0
    conv, cf, cn, last = False, -1, float("nan"), float("nan")
    t0 = time.perf_counter()
    while frame < frames:
        w = min(N_WIN, frames - frame)
        _, _, d = fu.step(w, SUB, DT, G, DAMP, **FLAGS)
        deg += d
        p = fu.pos.to_numpy().astype(np.float64)
        frame += w
        if not np.isfinite(p).all():
            log(f"  ★ 발산 — {cell} f={frame}")
            break
        net = float(np.linalg.norm(p - ref, axis=1).max())
        last = net
        trail.append((frame, net))
        ref = p
        if not conv and net <= TOL:
            conv, cf, cn = True, frame, net
            break
    sec = time.perf_counter() - t0
    p = fu.pos.to_numpy().astype(np.float64)
    p.tofile(str(OUT / f"{cell}.bin"))
    dv = np.linalg.norm(p - blob_pos, axis=1) * 1000.0
    meta = {"cell": cell, "fp": FPN, "arch": arch, "n": n, "substeps": SUB, "frames": frame,
            "headerFrames": BH["frame"], "tol": TOL, "converged": conv, "convFrame": cf,
            "convNet": cn, "lastNet": last, "degenerate": deg, "trail": trail,
            "sec": sec, "secPerFrame": sec / max(frame, 1), "jitSec": jit_s, "buildSec": build_s,
            "vs정본blob_mm": {"중앙": float(np.median(dv)), "p99": float(np.percentile(dv, 99)),
                           "최대": float(dv.max())},
            "self": {"쌍_서브스텝당": fu.sc_stat["pairs"] / max(fu.sc_stat["calls"], 1),
                     "해소_서브스텝당": fu.sc_stat["applied"] / max(fu.sc_stat["calls"], 1)}}
    json.dump(meta, open(OUT / f"{cell}.json", "w", encoding="utf-8"), indent=1, ensure_ascii=False)
    return meta


def layer3(cell, meta):
    """층3 — 기존 계기를 그대로 부른다(수정 0 · 물리 0프레임)."""
    env = dict(os.environ, PYTHONIOENCODING="utf-8", CELL=cell,
               POS=str((OUT / f"{cell}.bin").relative_to(Path.cwd())).replace("\\", "/"),
               TAG=f"bake-{NAME}-{cell}")
    subprocess.run(["npx", "tsx", "scripts/v4FitReport.ts"], env=env, shell=True, check=True,
                   capture_output=True)
    env2 = dict(env, NET=repr(float(meta["lastNet"])))
    subprocess.run(["npx", "tsx", "scripts/v4ProductGate.ts"], env=env2, shell=True, check=True,
                   capture_output=True)
    for src, dst in ((f"fit-{cell}-bake-{NAME}-{cell}.json", f"fit-{cell}.json"),
                     (f"l3-gate-{cell}-bake-{NAME}-{cell}.json", f"gate-{cell}.json")):
        (OUT / dst).write_bytes((load.EXPORT / src).read_bytes())
    return json.loads((OUT / f"gate-{cell}.json").read_text(encoding="utf-8"))


if CHILD:                                                 # ── 자식: 칸 «하나»만 굽는다 ──
    m = bake(CHILD_CELL)
    g = layer3(CHILD_CELL, m)
    (OUT / f"{CHILD_CELL}.done").write_text(time.strftime("%Y-%m-%d %H:%M:%S"), encoding="utf-8")
    log(f"{CHILD_CELL} · 정착 {'f' + str(m['convFrame']) if m['converged'] else '미도달'} · "
        f"{m['secPerFrame']:.3f} s/프레임 · JIT {m['jitSec']:.1f}s · ti.init {init_s:.1f}s · "
        f"vs 정본 중앙 {m['vs정본blob_mm']['중앙']:.6f} mm · pass {g['pass']}")
    sys.exit(0)

# ── 부모: 순서·PAUSE·체크포인트·로그만 맡는다(물리 0) ──
log(f"job {NAME} · 칸 {len(CELLS)} · fp {FPN} · arch {arch} · "
    f"PAUSE {'있음' if PAUSE.exists() else '없음'} · **칸마다 자식 프로세스**")
t_all = time.perf_counter()
fail = []
for cell in CELLS:
    if (OUT / f"{cell}.done").exists():
        log(f"건너뜀(체크포인트) {cell}")
        continue
    while PAUSE.exists():                                 # 다음 칸 시작 «전»에만 선다
        log(f"PAUSE — {cell} 시작 대기")
        time.sleep(10)
    t0 = time.perf_counter()
    r = subprocess.run([sys.executable, str(Path(__file__).resolve()), sys.argv[1],
                        "--child", cell], cwd=str(Path.cwd()))
    el = time.perf_counter() - t0
    if r.returncode != 0:                                 # §0-5ㄴ — 사유 적고 다음 칸(재시도 0)
        fail.append(cell)
        log(f"★ 자식 실패 {cell} · returncode {r.returncode} · {el:.1f}s — 다음 칸으로(재시도 0)")
    else:
        log(f"칸 끝 {cell} · 자식 벽시계 {el:.1f}s")
log(f"job {NAME} 끝 · 총 벽시계 {time.perf_counter() - t_all:.1f}s · 실패 {len(fail)}칸 {fail}")
