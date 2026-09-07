"""v4-46 §1-① — **A포즈 108칸 본굽기 드라이버**(실행 도구 · 물리 0줄 · 워커 0줄 · 새 문턱 0).

하는 일은 셋뿐이다.
  ① 그 칸의 조립 산출(`scene-<태그>.bin`)이 없으면 `scripts/v4AsmExport.ts` 를 부른다
  ② 워커 job json 을 쓴다(형식은 v4-45 와 같다 · cells 는 «한 칸»)
  ③ `gpu/bake/worker.py` 를 부른다 — 이미 `results/<job>/<칸>.done` 이 있으면 **건너뛴다**(재개)

몸·축·원점은 **그리드 정본**(v4-45 등재 · `gpu/oracle/export/grid27/`)에서 온다:
  BODY_BIN        grid27/l3ap-body-<몸>-a35.bin
  ARM_AXIS_JSON   grid27/l3ap-body-<몸>-a35.json
  ARM_ORIGIN_JSON grid27/l3ap-origin-<몸>-a35.json

태그 규약 — `<몸>_<사이즈>` 를 그대로 쓰면 `v4AsmExport` 의 `BODYTAG`(태그의 `_` 앞)가 **몸마다 하나**가 되어
SDF(`sdf-<몸>.bin`)가 몸당 1개로 모인다.

★★ **사고와 처분(v4-46 실측 · 반드시 읽는다)** — 태그를 `<몸>_<사이즈>`(= 칸 이름)로 두면
`scene-<칸>.bin`·`scene-bend-…`·`scene-seam-…`·`sdf-<몸>.bin` 이 **T포즈 정본 산출물과 같은 이름**이라
**덮어쓴다**. 이 판에서 실제로 추적 파일 **30개**가 덮여 `pytest` 가 **20건 실패**했다.
처분(실행한 것) — ① `git checkout -- gpu/oracle/export` 로 추적분 복구 ②
`sdf-<몸>.bin` 은 `.gitignore` 라 복구가 안 되므로 **기본(T포즈) 몸으로 조립 export 를 다시 돌려 재생성**
(25몸 성공 · 2몸은 T포즈에서 네 사이즈 모두 옷이 던져 재생성 불가 — 그 몸의 T포즈 SDF 는 원래 없다).
⟹ **이 드라이버를 다시 돌린 뒤에는 위 두 단계를 반드시 수행한다.**

진입: `py scripts/bake108.py <사이즈…>`  예) `py scripts/bake108.py M` · `py scripts/bake108.py S L XL`
      `--bodies c87.5-h155-s40,…` 로 몸을 좁힐 수 있다. `--dry` 는 «무엇을 할지»만 인쇄한다.
"""
import json
import os
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EXPORT = ROOT / "gpu" / "oracle" / "export"
GRID = EXPORT / "grid27"
JOBS = ROOT / "gpu" / "bake" / "jobs"
RESULTS = ROOT / "gpu" / "bake" / "results"
DEG = 35
JOB_NAME = "v4-46-A108"

args = [a for a in sys.argv[1:] if not a.startswith("--")]
DRY = "--dry" in sys.argv
only_bodies = None
for a in sys.argv[1:]:
    if a.startswith("--bodies"):
        only_bodies = a.split("=", 1)[1].split(",")
SIZES = args or ["M", "S", "L", "XL"]

bodies = sorted({p.name[len("l3ap-body-"):-len(f"-a{DEG}.bin")]
                 for p in GRID.glob(f"l3ap-body-*-a{DEG}.bin")})
if only_bodies:
    bodies = [b for b in bodies if b in only_bodies]

def env_for(body: str) -> dict:
    e = dict(os.environ)
    e.update(PYTHONIOENCODING="utf-8", PYTHONUTF8="1",
             BODY_BIN=f"gpu/oracle/export/grid27/l3ap-body-{body}-a{DEG}.bin",
             ARM_AXIS_JSON=f"gpu/oracle/export/grid27/l3ap-body-{body}-a{DEG}.json",
             ARM_ORIGIN_JSON=f"gpu/oracle/export/grid27/l3ap-origin-{body}-a{DEG}.json")
    return e

def log(msg: str) -> None:
    line = f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] {msg}"
    print(line, flush=True)
    with open(RESULTS / f"{JOB_NAME}-drive.log", "a", encoding="utf-8") as f:
        f.write(line + "\n")

RESULTS.mkdir(parents=True, exist_ok=True)
todo = [(b, s) for s in SIZES for b in bodies]
log(f"드라이버 시작 — 사이즈 {SIZES} · 몸 {len(bodies)} · 칸 {len(todo)}")

for i, (body, size) in enumerate(todo):
    cell = f"{body}_{size}"
    tag = cell                                        # BODYTAG = body ⟹ SDF 는 몸당 1개
    done = RESULTS / JOB_NAME / f"{tag}.done"
    if done.exists():
        log(f"[{i+1}/{len(todo)}] {cell} — .done 있음 · 건너뜀")
        continue
    scene = EXPORT / f"scene-{tag}.bin"
    """★ v4-46 실측 사고 — 「scene 파일이 있으면 건너뛴다」로 두었더니 **T포즈 시절의 동명 산출**
    (`scene-c100-h155-s50_M.bin` 2026-09-01 · `scene-c100-h170-s45_M.bin` 2026-08-30)을 재사용해
    조립을 건너뛰었고, `asm-*.bin` 이 없어 워커가 즉시 실패했다(1.3 s · returncode 1).
    조립은 **6초**뿐이므로 «항상» 다시 만든다 — 이름이 같다고 옛 몸의 산출을 쓰지 않는다. """
    if True:
        log(f"[{i+1}/{len(todo)}] {cell} — 조립 export{' (기존 scene 덮어씀)' if scene.exists() else ''}")
        if not DRY:
            e = env_for(body); e.update(CELL=cell, TAG=tag)
            r = subprocess.run(["npx", "tsx", "scripts/v4AsmExport.ts"], cwd=ROOT, env=e,
                               shell=True, capture_output=True, text=True, encoding="utf-8", errors="replace")
            if r.returncode != 0:
                tail = (r.stderr or r.stdout or "").strip().splitlines()[-3:]
                log(f"[{i+1}/{len(todo)}] {cell} — **조립 던짐** · {' / '.join(tail)}")
                (RESULTS / JOB_NAME).mkdir(parents=True, exist_ok=True)
                (RESULTS / JOB_NAME / f"{tag}.throw.json").write_text(
                    json.dumps({"cell": cell, "stage": "assemble", "err": (r.stderr or r.stdout)[-2000:]},
                               ensure_ascii=False, indent=1), encoding="utf-8")
                continue
    jf = JOBS / f"{JOB_NAME}-{tag}.json"
    jf.write_text(json.dumps({"name": JOB_NAME, "fp": "f64", "arch": "cuda", "frames": 400,
                              "cells": [{"cell": tag, "asm": f"asm-{tag}.bin", "reportCell": cell,
                                         "frames": 400,
                                         "cellCap": {"cell_cap": 192, "max_cells": 262144},
                                         "ramp": True}]}, ensure_ascii=False, indent=1), encoding="utf-8")
    log(f"[{i+1}/{len(todo)}] {cell} — 굽기 시작")
    if DRY:
        continue
    t0 = time.perf_counter()
    r = subprocess.run(["py", "gpu/bake/worker.py", str(jf.relative_to(ROOT)).replace("\\", "/")],
                       cwd=ROOT, env=env_for(body), capture_output=True, text=True,
                       encoding="utf-8", errors="replace")
    el = time.perf_counter() - t0
    meta = RESULTS / JOB_NAME / f"{tag}.json"
    ok = meta.exists()
    extra = ""
    if ok:
        m = json.loads(meta.read_text(encoding="utf-8"))
        extra = f" · 정착 f{m.get('frames')} · convNet {m.get('lastNet')} · {m.get('secPerFrame')} s/프레임"
    log(f"[{i+1}/{len(todo)}] {cell} — 끝({el:.1f}s · rc {r.returncode}){extra}")
log("드라이버 끝")
