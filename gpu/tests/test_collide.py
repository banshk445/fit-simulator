"""v4-05 §2 — **몸 충돌 이식**을 층1(1스텝)로 고정한다.

상한은 인용이다 — `K × ULP_f32(그 자리 값)` · **M 없음**(v4-04 §0-2 층1).
K = **34**(충돌 해소 사슬의 깊이 · `gpu/engine/ulp.py` · 커널 코드에서 «센» 값 ·
예측 단계의 깊이 4 는 **세지 않는다** = 더 엄격한 쪽).

**대조 자산 주의** — 몸 SDF 격자(`sdf-<body>.bin`)는 **64 MB 라 git 밖**이다(`.gitignore`).
없으면 이 파일의 시험은 **skip** 된다. 재생성: `DUMP=<cell> npx tsx scripts/v4Export.ts`.
"""
import json
import struct
import sys
from pathlib import Path

import numpy as np
import pytest
import taichi as ti

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from oracle import load  # noqa: E402
from engine import collide as CO, ulp as U  # noqa: E402
from _backend import needs_f64, GPU  # noqa: E402

BASE = "c100-h170-s45_M"
BODY = "c100-h170-s45"
STEP = load.EXPORT / f"cellstep-collision-{BASE}.bin"
SDF = load.EXPORT / f"sdf-{BODY}.bin"
missing = pytest.mark.skipif(
    not (STEP.exists() and SDF.exists()),
    reason=("충돌 대조 자산 없음 — `CONS=collision npx tsx scripts/v4CellStep.ts` 와 "
            "`DUMP=c100-h170-s45_M npx tsx scripts/v4Export.ts`(SDF 64MB · git 밖) 를 먼저 돌린다"))


def _load_step():
    raw = STEP.read_bytes()
    (hl,) = struct.unpack_from("<I", raw, 0)
    head = json.loads(raw[4:4 + hl].decode("utf-8"))
    pay = raw[4 + hl:]
    n = head["n"]
    before = np.frombuffer(pay, dtype="<f8", count=n * 3, offset=0).reshape(n, 3)
    after = np.frombuffer(pay, dtype="<f8", count=n * 3, offset=n * 3 * 8).reshape(n, 3)
    return head, before, after


def _run(fp, npfp):
    head, before, after = _load_step()
    _, invm, _, _ = load.scene(BASE)
    sh, sdata = CO.load_sdf(SDF)
    ti.init(arch=GPU, default_fp=fp)
    assert ti.lang.impl.current_cfg().arch == GPU, "조용한 arch 폴백(v4-01 함정 1)"
    co = CO.Collide(before.astype(npfp), np.zeros((head["n"], 3), npfp), invm.astype(npfp),
                    sh, sdata, head["THICK"], head["MU"], fp=fp)
    p, _, hits, md = co.step(1, 1, head["h"], head["G"], 0.0)
    return head, p.astype(np.float64), after, hits, md


@missing
def test_sdf_grid_matches_registered():
    sh, sdata = CO.load_sdf(SDF)
    assert (sh["nx"], sh["ny"], sh["nz"]) == (459, 456, 80)      # v4-05 §1-③ 실측
    assert sdata.size == sh["nx"] * sh["ny"] * sh["nz"]
    assert sdata.dtype == np.float32                             # v3 도 Float32Array 다
    assert abs(sh["h"] - 0.0038049) < 1e-7
    assert (np.abs(sdata) <= sh["band"] + 1e-6).all()            # bakeSdf 가 band 로 자른다


@missing
@needs_f64
def test_layer1_collide_port_is_exact_in_f64():
    """**이식 자체가 옳은가** — f64 로 돌리면 v3 와 «수치적으로 같아야» 한다."""
    head, p, after, hits, _ = _run(ti.f64, np.float64)
    assert hits > 0                                              # 충돌이 실제로 발화했다
    assert np.abs(p - after).max() <= 8.0 * np.spacing(float(np.abs(after).max()))


@missing
def test_layer1_collide_f32_within_bound():
    """**층1 판정** — 실측 1.115526e-07 · 비 최대 0.0275 · 초과 정점 0 / 9,388."""
    head, p, after, hits, _ = _run(ti.f32, np.float32)
    r = U.layer1(p - after, after, U.K_COLLIDE_DEPTH_PER_CON, 1)
    assert (r <= 1).all(), f"초과 정점 {(r > 1).sum()} · 최대 비 {r.max():.4f}"


@missing
@needs_f64
def test_collide_hit_count_is_precision_sensitive():
    """★ **분기 판정이 정밀도에 민감하다는 «사실»을 고정한다**(문턱 아님).

    `d < 0` 경계에 걸친 정점이 많아 발화 수가 정밀도로 갈린다 — f32 **536** ↔ f64 **1057**.
    그런데도 최종 위치 차는 1.12e-07 에 머문다(경계 정점의 `depth ≈ 0` 이라 밀어내는 양이 없다).
    """
    _, _, _, h32, _ = _run(ti.f32, np.float32)
    _, _, _, h64, _ = _run(ti.f64, np.float64)
    assert h32 == 536 and h64 == 1057
