"""v4-03 §2 — ③ 굽힘 제약 이식을 **pytest** 로 고정한다.

문턱은 전부 **인용**이다 — 이 파일이 새로 정하는 수는 0이다.
  · 상한 = **K × deg × ULP_f32(최대|좌표|) × M** (`gpu/engine/ulp.py` · v4-03 §0-4 절차로 «먼저» 등재)
  · **ㄴ(정답지 1칸)은 통과**, **ㄱ(합성 힌지)은 초과**(갈래 C). 문턱을 옮기지 않고
    `xfail(strict)` 로 고정한다 — 통과로 바뀌면 pytest 가 «예상 밖 통과»로 알려 준다(함정 14).
"""
import sys
from pathlib import Path

import numpy as np
import pytest
import taichi as ti

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from oracle import load  # noqa: E402
from engine import stretch as S, bending as B, ulp as U  # noqa: E402
from _backend import needs_f64  # noqa: E402

BASE = "c100-h170-s45_M"
GPU = ti.metal if sys.platform == "darwin" else ti.cuda
missing = pytest.mark.skipif(not (load.EXPORT / "hinge-v3.bin").exists(),
                             reason="굽힘 덤프 없음 — scripts/v4Hinge.ts · v4Export.ts 를 먼저 돌린다")


def _hinge_pos(fp, npfp, frames=None):
    """합성 힌지를 M 프레임 돌린 «위치»(f64 로 올려 돌려준다) + 퇴화 발화 수 + 헤더."""
    hh, uv, tris, bidx, invm, pos3, _ = load.hinge_v3()
    n = hh["n"]
    pos0 = np.zeros((n, 3)); pos0[:, 0] = uv[:, 0]; pos0[:, 2] = uv[:, 1]
    pos0[3, 1] = hh["d"]; pos0[3, 2] = 0.0            # 90° 접은 초기(v4Hinge.ts 정의)
    ti.init(arch=GPU, default_fp=fp)
    assert ti.lang.impl.current_cfg().arch == GPU, "조용한 arch 폴백(v4-01 함정 1)"
    bi, bp = B.make_bend(tris, uv, hh["ke"], npfp)
    inv, _ = S.assign_mass(n, tris, uv, hh["rho"], pinned=hh["pinned"], dtype=npfp)
    bn = B.Bending(pos0.astype(npfp), np.zeros((n, 3), npfp), inv, bi, bp, hh["ke"], fp=fp)
    p, _, dg = bn.step(frames or hh["frames"], hh["substeps"], hh["DT"], hh["G"], hh["DAMP"])
    return hh, p.astype(np.float64), dg, pos3


def _hinge(fp, npfp, frames=None):
    """v3 정답(M=600)과의 대조 — `frames` 를 바꾸면 대조가 무의미하니 기본만 쓴다."""
    hh, p, dg, pos3 = _hinge_pos(fp, npfp, frames)
    return hh, np.abs(p - pos3).max(), dg, float(np.abs(pos3).max())


def _cell(fp, npfp):
    hb, bidx, bpar = load.scene_bend(BASE)
    hc, before, after = load.cell_step_bend(BASE)
    _, invm, _, _ = load.scene(BASE)                   # 같은 조립 ⟹ 같은 invMass
    n = hb["n"]
    ti.init(arch=GPU, default_fp=fp)
    assert ti.lang.impl.current_cfg().arch == GPU
    bn = B.Bending(before.astype(npfp), np.zeros((n, 3), npfp), invm.astype(npfp),
                   bidx, bpar.astype(npfp), hb["ke"], fp=fp)
    p, _, dg = bn.step(1, 1, hc["h"], 0.0, 0.0)
    deg = np.bincount(bidx.reshape(-1), minlength=n)
    return np.abs(p.astype(np.float64) - after).max(), dg, float(np.abs(before).max()), int(deg.max())


# ─── 이식이 v3 의 «조립»과 같은가 ─────────────────────────────────
@missing
def test_make_bend_matches_v3():
    """`makeBend` 이식 — 합성 힌지에서 제약 수·정점 순서·`shape` 가 v3 와 같아야 한다."""
    hh, uv, tris, bidx, _, _, _ = load.hinge_v3()
    bi, bp = B.make_bend(tris, uv, hh["ke"], np.float64)
    assert bi.shape == (1, 4) and bi.tolist() == bidx.tolist()
    assert bp[0, 0] == hh["restAngle"] == 0.0          # 평면 제도 ⟹ restAngle 0
    assert bp[0, 1] == hh["shape"]                     # shape = 4a/l²


@missing
def test_cell_bend_scene_shape():
    hb, bidx, bpar = load.scene_bend(BASE)
    assert hb["n"] == 9388 and hb["mb"] == 26648       # v4-03 §1-③ 덤프
    assert bidx.shape == (26648, 4) and bpar.shape == (26648, 2)
    assert (bpar[:, 0] == 0.0).all()                   # restAngle 전량 0
    assert (bpar[:, 1] > 0).all()                      # shape = 4a/l² > 0


# ─── ㄱ 합성 힌지 ────────────────────────────────────────────────
@missing
@needs_f64
def test_hinge_port_is_exact_in_f64():
    """**이식 자체가 옳은가** — f64 로 돌리면 v3 와 «수치적으로 같아야» 한다."""
    hh, d, dg, mx = _hinge(ti.f64, np.float64)
    assert dg == 0                                     # 퇴화 분기 미발화 ⟹ v3 와 구별 불가
    assert d <= 8.0 * np.spacing(mx)


@missing
def test_hinge_degenerate_branch_never_fires():
    _, _, dg, _ = _hinge(ti.f32, np.float32)
    assert dg == 0


@missing
@needs_f64
@pytest.mark.parametrize("frames", [1, 10])
def test_hinge_short_horizon_within_bound(frames):
    """M 이 작으면 f32 도 상한 «안»이다 — 초과는 «스텝당 오차»가 아니라 **증폭** 때문이다.

    v3 정답은 M=600 것 하나뿐이므로 여기서는 **같은 커널의 f64 궤적**을 자로 쓴다
    (f64 가 v3 와 1e-16 안에서 같다는 것은 `test_hinge_port_is_exact_in_f64` 가 따로 고정한다).
    """
    _, p32, _, _ = _hinge_pos(ti.f32, np.float32, frames)
    _, p64, _, _ = _hinge_pos(ti.f64, np.float64, frames)
    d = np.abs(p32 - p64).max()
    assert d <= U.bound(U.K_BEND_DEPTH_PER_CON, 1, float(np.abs(p64).max()), frames)


@missing
@needs_f64
@pytest.mark.xfail(strict=True, reason=(
    "v4-03 §4 **갈래 C** — 합성 힌지 M=600 에서 f32 가 상한을 **30.1배** 넘는다(1.292866e-02 ↔ 4.291534e-04). "
    "f64 는 1.110223e-16 ⟹ 이식은 정확하다. 원인은 **상한식이 M 에 «선형»인데 이 계기의 오차가 "
    "«지수 증폭»한다는 것**(M=1 비 0.382 → 10 비 0.206 → 60 비 1.691 → 200 비 19.96 → 600 비 30.13). "
    "문턱은 옮기지 않는다(함정 14) — 처분은 전략 세션 몫."))
def test_hinge_within_bound_f32():
    hh, d, _, mx = _hinge(ti.f32, np.float32)
    assert d <= U.bound(U.K_BEND_DEPTH_PER_CON, 1, mx, hh["frames"])


# ─── ㄴ 정답지 1칸 ───────────────────────────────────────────────
@missing
@needs_f64
def test_cell_bend_port_is_exact_in_f64():
    d, dg, mx, _ = _cell(ti.f64, np.float64)
    assert dg == 0
    assert d <= 8.0 * np.spacing(mx)


@missing
def test_cell_bend_within_bound_f32():
    """**통과** — 실측 4.114550e-07 ≤ 상한 3.433228e-05(K 24 × deg 12 × ULP × M 1)."""
    d, dg, mx, deg = _cell(ti.f32, np.float32)
    assert dg == 0
    assert d <= U.bound(U.K_BEND_DEPTH_PER_CON, deg, mx, 1)
