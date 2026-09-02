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


def _unpack(path):
    """[u32 헤더길이][헤더 JSON][페이로드] — 정착 blob 과 조립 blob 이 «같은 포장»이다."""
    raw = Path(path).read_bytes()
    hl = struct.unpack("<I", raw[:4])[0]
    return json.loads(raw[4:4 + hl].decode("utf-8")), np.frombuffer(raw[4 + hl:], dtype="<f8")


def bake(cell, asm=None, frames_in=None, cap=None, ramp=False):
    """`asm` 이 있으면 **조립 입력 모드**(v4-20 §1-①) — 초기 상태를 조립 산출에서 읽는다.
    없으면 v4-18 이 «채택»한 기존 모드 그대로다(정착 blob 에서 읽는다 · **그 경로 diff 0**)."""
    body = cell.rsplit("_", 1)[0]
    if asm is not None:
        BH, state = _unpack(load.EXPORT / asm)
        frames = int(frames_in or JOB.get("frames") or 200)
    else:
        raw = (Path("public/v3diag/v3-77") / f"settled-{cell}.bin").read_bytes()
        hl = struct.unpack("<I", raw[:4])[0]
        BH = json.loads(raw[4:4 + hl].decode("utf-8"))
        frames = int(JOB.get("frames") or BH["frame"])
    hs, invm, ip_idx, ip_par = load.scene(cell)
    hb, bd_idx, bd_par = load.scene_bend(cell)
    hm, sm_idx, sm_rest = SE.load_seam(load.EXPORT / f"scene-seam-{cell}.bin")
    sh, sdata = CO.load_sdf(load.EXPORT / f"sdf-{body}.bin")
    n = hs["n"]
    assert n == BH["n"], f"정점 수가 다르다 — blob {BH['n']} ≠ 조립 {n}"
    st = state if asm is not None else load.cloth(cell)[1]
    pos0 = st[: n * 3].reshape(n, 3).astype(npfp)
    vel0 = st[n * 3:].reshape(n, 3).astype(npfp)
    blob_pos = st[: n * 3].reshape(n, 3).astype(np.float64)
    tris = np.ascontiguousarray(ip_idx.astype(np.int32))
    t0 = time.perf_counter()
    # ★ v4-20 — 셀 용량은 **호출부에서** 준다(`engine/` 바이트 불변 · 물리 식 0줄).
    #   조립 «직후» 상태는 정착 상태보다 한 셀에 삼각형이 몰려 기본값 64 로는 넘친다(§1-① 실측).
    #   `slot` 은 `max_cells × cell_cap` 이라 용량을 올릴 때 셀 수를 함께 내린다(할당 폭발 방지).
    #   넘치면 커널이 **던진다**(조용한 누락 0) — 그래서 «용량»만 올린다. 쌍 집합 정의는 그대로다.
    sc_kw = dict(cap or {})          # 예: {"cell_cap": 192, "max_cells": 131072}
    fu = FS.FullSC(pos0, vel0, invm.astype(npfp), ip_idx, ip_par.astype(npfp), hs["k"],
                   bd_idx, bd_par.astype(npfp), hb["ke"], sm_idx, sm_rest.astype(npfp),
                   sh, sdata, sh["THICK"], sh["MU"], fp=fp, tris=tris, sc_kw=sc_kw)
    build_s = time.perf_counter() - t0
    DT, G, DAMP, SUB, N_WIN = 1 / 60, 9.81, 6.0, hs["substeps"], 10
    t_jit = time.perf_counter()
    fu.step(1, SUB, DT, G, DAMP, **FLAGS)                # 예열(JIT) — 벽시계 밖
    jit_s = time.perf_counter() - t_jit
    fu.pos.from_numpy(np.ascontiguousarray(pos0, dtype=npfp))
    fu.vel.from_numpy(np.ascontiguousarray(vel0, dtype=npfp))
    ti.sync()
    # ── v4-21 §1-① **봉제 램프**(추가 단계 · `ramp` 가 참일 때만 돈다 · 커널 식 0줄) ──
    #   인용 dressRun.ts:111-116 · 177-178 —
    #     rest0[k] = |pos_i − pos_j|(조립 «직후» 위치) · RAMP_N = ceil((max rest0 − SEP)/(G·DT²)) ·
    #     프레임 f(0부터) «전»에 t = min(1, (f+1)/RAMP_N) 로 rest[k] = rest0[k] + (SEP − rest0[k])·t
    #   ★ 커널은 `sm_rest` 를 읽기만 한다 — 이 배열을 «호출부»가 프레임마다 갱신한다.
    ramp_meta = None
    if ramp:
        p0 = st[: n * 3].reshape(n, 3).astype(np.float64)
        si = np.asarray(sm_idx, np.int64)
        rest0 = np.linalg.norm(p0[si[:, 0]] - p0[si[:, 1]], axis=1)
        SEPm = 2.0 * float(sh["THICK"])
        rampN = int(np.ceil((rest0.max() - SEPm) / (G * DT * DT)))
        ramp_meta = {"rampN": rampN, "rest0Max": float(rest0.max()), "rest0Min": float(rest0.min()),
                     "SEP": SEPm, "mode": "dressRun.ts:111-116 선형 · setRest 는 step «앞»"}
        log(f"  램프 — RAMP_N {rampN} · rest0 {rest0.min():.6e}~{rest0.max():.6e} · SEP {SEPm:.6e}")

    ref = fu.pos.to_numpy().astype(np.float64)
    trail, frame, deg = [], 0, 0
    conv, cf, cn, last = False, -1, float("nan"), float("nan")
    t0 = time.perf_counter()
    while frame < frames:
        if ramp:                                          # 프레임 단위(램프가 매 프레임 rest 를 바꾼다)
            tt = min(1.0, (frame + 1) / rampN)
            fu.sm_rest.from_numpy(np.ascontiguousarray(
                rest0 + (ramp_meta["SEP"] - rest0) * tt, dtype=npfp))
        w = 1 if ramp else min(N_WIN, frames - frame)
        _, _, d = fu.step(w, SUB, DT, G, DAMP, **FLAGS)
        deg += d
        frame += w
        if ramp and frame % N_WIN != 0 and frame < frames:
            continue                                      # 창 경계에서만 잰다(순변위 식·창 정의 불변)
        p = fu.pos.to_numpy().astype(np.float64)
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
    meta = {"cell": cell, "inputMode": "assembled" if asm is not None else "settled",
            "asm": asm, "cellCap": cap, "ramp": ramp_meta, "fp": FPN, "arch": arch, "n": n, "substeps": SUB, "frames": frame,
            "headerFrames": BH["frame"], "tol": TOL, "converged": conv, "convFrame": cf,
            "convNet": cn, "lastNet": last, "degenerate": deg, "trail": trail,
            "sec": sec, "secPerFrame": sec / max(frame, 1), "jitSec": jit_s, "buildSec": build_s,
            "vs정본blob_mm": {"중앙": float(np.median(dv)), "p99": float(np.percentile(dv, 99)),
                           "최대": float(dv.max())},
            "self": {"쌍_서브스텝당": fu.sc_stat["pairs"] / max(fu.sc_stat["calls"], 1),
                     "해소_서브스텝당": fu.sc_stat["applied"] / max(fu.sc_stat["calls"], 1)}}
    json.dump(meta, open(OUT / f"{cell}.json", "w", encoding="utf-8"), indent=1, ensure_ascii=False)
    return meta


def layer3(cell, meta, report_cell=None):
    """층3 — 기존 계기를 그대로 부른다(수정 0 · 물리 0프레임)."""
    env = dict(os.environ, PYTHONIOENCODING="utf-8", CELL=(report_cell or cell),
               POS=str((OUT / f"{cell}.bin").relative_to(Path.cwd())).replace("\\", "/"),
               TAG=f"bake-{NAME}-{cell}")
    subprocess.run(["npx", "tsx", "scripts/v4FitReport.ts"], env=env, shell=True, check=True,
                   capture_output=True)
    env2 = dict(env, NET=repr(float(meta["lastNet"])))
    subprocess.run(["npx", "tsx", "scripts/v4ProductGate.ts"], env=env2, shell=True, check=True,
                   capture_output=True)
    rc = report_cell or cell                              # 리포트·게이트는 «옷 칸» 이름으로 난다
    for src, dst in ((f"fit-{rc}-bake-{NAME}-{cell}.json", f"fit-{cell}.json"),
                     (f"l3-gate-{rc}-bake-{NAME}-{cell}.json", f"gate-{cell}.json")):
        (OUT / dst).write_bytes((load.EXPORT / src).read_bytes())
    return json.loads((OUT / f"gate-{cell}.json").read_text(encoding="utf-8"))


SPEC = {}
for _c in CELLS:                                          # 칸은 문자열이거나 {cell, asm, …} 이다
    if isinstance(_c, dict):
        SPEC[_c["cell"]] = _c
CELL_IDS = [c["cell"] if isinstance(c, dict) else c for c in CELLS]

if CHILD:                                                 # ── 자식: 칸 «하나»만 굽는다 ──
    sp = SPEC.get(CHILD_CELL, {})
    m = bake(CHILD_CELL, asm=sp.get("asm"), frames_in=sp.get("frames"), cap=sp.get("cellCap"),
              ramp=bool(sp.get("ramp")))
    g = layer3(CHILD_CELL, m, report_cell=sp.get("reportCell"))
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
for cell in CELL_IDS:
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
