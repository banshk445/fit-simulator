"""v4-04 §2 — **검증 3층**을 pytest 로 고정한다(§0-2 등재분).

  · **층1** 1스텝 정확도 — 상한 = `K × ULP_f32(그 자리 값)` · **M 없음**.
    「그 자리 값」 = 그 정점 «위치»의 최대 성분 크기 · K = 제약 **하나**의 깊이(**더 엄격한 쪽**).
  · **층2** 수렴 도달 — **상한은 등재하지 않았다**(§0-2). 그래서 여기서 고정하는 것은 **문턱이 아니라 «사실»**이다:
    「f64 는 v3 와 «같은 프레임»에 수렴한다」 · 「f32 는 strip 에서 수렴하고 hinge 에서 «수렴하지 않는다»」.
    수치 상한을 세우지 않는다 — 사후 문턱 금지.
  · 층3(관측량)은 이 판에서 착수 0(갈래 D 정지).
"""
import sys
from pathlib import Path

import numpy as np
import pytest
import taichi as ti

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from oracle import load  # noqa: E402
from engine import stretch as S, bending as B, ulp as U, converge as C  # noqa: E402
from _backend import needs_f64, GPU  # noqa: E402

BASE = "c100-h170-s45_M"
missing1 = pytest.mark.skipif(not (load.EXPORT / "cellstep-bend-c100-h170-s45_M.bin").exists(),
                              reason="1스텝 덤프 없음 — scripts/v4CellStep.ts 를 먼저 돌린다")
missing2 = pytest.mark.skipif(not (load.EXPORT / "converge-hinge-v3.bin").exists(),
                              reason="수렴 덤프 없음 — scripts/v4Converge.ts 를 먼저 돌린다")


# ══ 층1 — 1스텝 정확도 ══════════════════════════════════════════════
@missing1
def test_layer1_stretch():
    """늘어남 1스텝 — 정점마다 «그 자리 값»으로 만든 자로 재고, **초과 정점 0** 이어야 한다."""
    hs, invm, idx, par = load.scene(BASE)
    hc, before, after = load.cell_step(BASE)
    n = hs["n"]
    ti.init(arch=GPU, default_fp=ti.f32)
    assert ti.lang.impl.current_cfg().arch == GPU
    st = S.Stretch(before.astype(np.float32), np.zeros((n, 3), np.float32),
                   invm.astype(np.float32), idx, par.astype(np.float32), hs["k"])
    p, _ = st.step(1, 1, hc["h"], 0.0, 0.0)
    r = U.layer1(p.astype(np.float64) - after, after, U.K_STRETCH_DEPTH_PER_CON, 1)
    assert (r <= 1).all(), f"초과 정점 {(r > 1).sum()} · 최대 비 {r.max():.4f}"


@missing1
def test_layer1_bending():
    hb, bidx, bpar = load.scene_bend(BASE)
    hc, before, after = load.cell_step_bend(BASE)
    _, invm, _, _ = load.scene(BASE)
    n = hb["n"]
    ti.init(arch=GPU, default_fp=ti.f32)
    assert ti.lang.impl.current_cfg().arch == GPU
    bn = B.Bending(before.astype(np.float32), np.zeros((n, 3), np.float32),
                   invm.astype(np.float32), bidx, bpar.astype(np.float32), hb["ke"])
    p, _, dg = bn.step(1, 1, hc["h"], 0.0, 0.0)
    assert dg == 0
    r = U.layer1(p.astype(np.float64) - after, after, U.K_BEND_DEPTH_PER_CON, 1)
    assert (r <= 1).all(), f"초과 정점 {(r > 1).sum()} · 최대 비 {r.max():.4f}"


# ══ 층2 — 수렴 도달 ════════════════════════════════════════════════
def _converge(sys_name, fp, npfp):
    h, uv, tris, invm, pos3, _ = load.converge_v3(sys_name)
    n = h["n"]
    pos0 = np.zeros((n, 3)); pos0[:, 0] = uv[:, 0]; pos0[:, 2] = uv[:, 1]
    if sys_name == "hinge":
        pos0[3, 1] = h["d"]; pos0[3, 2] = 0.0
    ti.init(arch=GPU, default_fp=fp)
    assert ti.lang.impl.current_cfg().arch == GPU
    inv, _ = S.assign_mass(n, tris, uv, h["rho"], pinned=h["pinned"], dtype=npfp)
    if sys_name == "strip":
        i, p = S.make_inplane(tris, uv, npfp)
        solver = S.Stretch(pos0.astype(npfp), np.zeros((n, 3), npfp), inv, i, p, h["k"], fp=fp)
    else:
        i, p = B.make_bend(tris, uv, h["ke"], npfp)
        solver = B.Bending(pos0.astype(npfp), np.zeros((n, 3), npfp), inv, i, p, h["ke"], fp=fp)
    pf, fr, net, conv, _ = C.run_to_convergence(
        solver, h["N_WIN"], h["tol"], h["substeps"], h["DT"], h["G"], h["DAMP"], h["cap"])
    return h, pf, fr, net, conv, pos3


@missing2
@needs_f64
@pytest.mark.parametrize("sys_name", ["strip", "hinge"])
def test_layer2_f64_reaches_same_point(sys_name):
    """f64 는 v3 와 **같은 프레임**에 수렴하고 **같은 자리**에 선다 — 이식이 옳다는 도착점 증거.

    자는 **v3 자신의 수렴 문턱**(`s4Gate.ts:settleNetM` = `TOL_SELF` = 1e-4 m)을 «인용»한다 —
    **이 시험이 새로 정하는 수는 0**이다(§0-2 층2 는 상한을 등재하지 않았다).
    실측: strip **4.940492e-15** · hinge **1.110223e-16** — 인용 문턱의 각각 **5e-11 · 1e-12** 배다.
    """
    h, pf, fr, _, conv, pos3 = _converge(sys_name, ti.f64, np.float64)
    assert conv and fr == h["frames"]
    assert np.abs(pf - pos3).max() <= h["tol"]


@missing2
def test_layer2_f32_strip_converges():
    """strip(늘어남) — f32 도 **수렴한다**. 최종 좌표차에는 **상한을 걸지 않는다**(§0-2 층2)."""
    h, pf, fr, net, conv, pos3 = _converge("strip", ti.f32, np.float32)
    assert conv, f"f32 strip 이 {fr} 프레임에 미수렴(net {net:.3e})"


@missing2
@pytest.mark.xfail(strict=True, reason=(
    "v4-04 §1-② 실측 — f32 는 hinge 에서 **수렴하지 않는다**(20,000 프레임 상한 도달 · "
    "창 순변위가 2.479553e-04 에 «고정»된다). 자유 날개가 **중립 방향**으로 등속 표류하고 "
    "최종 위치가 v3 와 **0.496 m** 벌어진다(이면각은 v3 −7.393e-04 ↔ v4 −7.24e-28). "
    "★ 계기 판별력 검사에서 **v3 자신도** 이 방향으로 섭동을 **1:1 로 보존**한다 ⟹ "
    "이 합성계는 평형이 «유일하지 않고» 최종 정점 좌표가 well-posed 하지 않다. "
    "문턱을 만들지 않는다 — 처분은 전략 세션 몫(v4-04 §4 갈래 D)."))
def test_layer2_f32_hinge_converges():
    _, _, fr, net, conv, _ = _converge("hinge", ti.f32, np.float32)
    assert conv


@missing2
@pytest.mark.parametrize("sys_name,expect_neutral", [("strip", False), ("hinge", True)])
def test_layer2_instrument_discriminating_power(sys_name, expect_neutral):
    """**계기가 «구현 차이»를 잴 수 있는가** — v3 를 초기값만 1e-7 흔들어 v3 와 대조한 실측을 고정한다.

    strip 은 섭동을 **0.00095배로 줄이고**(수축계 ⟹ 판별력 있음),
    hinge 는 **1.00배로 보존한다**(중립 방향 ⟹ 최종 좌표로는 구현을 못 가린다).
    """
    import json, struct
    _, _, _, _, pos, _ = load.converge_v3(sys_name)
    raw = (load.EXPORT / f"converge-{sys_name}-v3-p.bin").read_bytes()
    (hl,) = struct.unpack_from("<I", raw, 0)
    hp = json.loads(raw[4:4 + hl].decode("utf-8"))
    pay = raw[4 + hl:]
    n, nt = hp["n"], hp["tris"]
    off = n * 2 * 8 + nt * 3 * 4 + n * 8
    posp = np.frombuffer(pay, dtype="<f8", count=n * 3, offset=off).reshape(n, 3)
    gain = float(np.abs(posp - pos).max()) / hp["perturb"]
    assert (gain >= 0.5) == expect_neutral, f"{sys_name} 섭동 이득 {gain:.4g}"
