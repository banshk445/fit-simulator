"""v4-06 §2 — **봉제 이식**(층1) + **결합 커널의 «옮겨적기» 검증**.

  · 층1 상한은 인용이다 — `K × ULP_f32(그 자리 값)` · **M 없음** · K = **12**(봉제 사슬 깊이).
  · 결합 커널(`gpu/engine/full.py`)은 네 갈래의 산술을 **옮겨 적은** 것이다. 옮겨적기가 어긋나면
    층2 전체가 무의미해지므로 **기계로 막는다**: 갈래를 «하나만» 켜고 1스텝 돌려
    **각 단일 커널의 v3 정답과 대조**한다. 사람이 눈으로 대조하지 않는다.
"""
import sys
from pathlib import Path

import numpy as np
import pytest
import taichi as ti

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from oracle import load  # noqa: E402
from engine import seam as SE, collide as CO, full as F, ulp as U  # noqa: E402
from _backend import needs_f64, GPU  # noqa: E402

BASE = "c100-h170-s45_M"
BODY = "c100-h170-s45"
SEAM = load.EXPORT / f"scene-seam-{BASE}.bin"
SDF = load.EXPORT / f"sdf-{BODY}.bin"
missing = pytest.mark.skipif(not SEAM.exists(),
                             reason="봉제 덤프 없음 — `DUMP=… npx tsx scripts/v4Export.ts` 를 먼저 돌린다")
missing_full = pytest.mark.skipif(
    not (SEAM.exists() and SDF.exists()),
    reason="결합 대조 자산 없음 — 봉제 덤프 + SDF(64MB · git 밖)가 필요하다")


def _seam_run(fp, npfp):
    sh, sidx, srest = SE.load_seam(SEAM)
    hc, before, after = load.cell_step_kind(BASE, "dist")
    _, invm, _, _ = load.scene(BASE)
    n = sh["n"]
    ti.init(arch=GPU, default_fp=fp)
    assert ti.lang.impl.current_cfg().arch == GPU, "조용한 arch 폴백(v4-01 함정 1)"
    sv = SE.Seam(before.astype(npfp), np.zeros((n, 3), npfp), invm.astype(npfp),
                 sidx, srest.astype(npfp), sh["k"], fp=fp)
    p, _ = sv.step(1, 1, hc["h"], 0.0, 0.0)
    return p.astype(np.float64), after


# ── 봉제 조립이 v3 와 같은가 ──────────────────────────────────────
@missing
def test_seam_scene_matches_v3():
    """봉제 제약 수 · `rest` · `k` — v3 등재값과 «값으로» 대조한다.

    ★ 램프 확인: `dressRun.setRest` 는 `rest` 를 `rest0 → SEP` 로 당기는데, 이 판은 정착 상태에서
    시작하고 `setRest` 를 부르지 않는다. 실측 **rest 최소 = 최대 = SEP = 2e-3** · `RAMP_N = 79 < 180`
    (정착 프레임) ⟹ **정착 시점의 값과 같다**(가정 0).
    """
    sh, sidx, srest = SE.load_seam(SEAM)
    assert sh["ms"] == 256 and sh["n"] == 9388            # garmentScene.ts:715-730 · 10 이음
    assert sh["k"] == 69 and sh["SEP"] == 0.002           # KMEM = 원단 k · SEP = 2×THICK
    assert srest.min() == srest.max() == 0.002
    assert sh["rampN"] == 79 and sh["rampN"] < 180
    assert int(np.bincount(sidx.reshape(-1), minlength=sh["n"]).max()) == 2


# ── 층1 ──────────────────────────────────────────────────────────
@missing
def test_layer1_seam_f32_within_bound():
    """**층1 판정** — 실측 1.128950e-07 · 비 최대 0.0810 · 초과 정점 0 / 9,388."""
    p, after = _seam_run(ti.f32, np.float32)
    r = U.layer1(p - after, after, U.K_SEAM_DEPTH_PER_CON, 1)
    assert (r <= 1).all(), f"초과 정점 {(r > 1).sum()} · 최대 비 {r.max():.4f}"


@missing
@needs_f64
def test_layer1_seam_port_is_exact_in_f64():
    """f64 로 돌리면 v3 와 **비트 동일**이다(실측 차 **0.000000e+00**)."""
    p, after = _seam_run(ti.f64, np.float64)
    assert np.abs(p - after).max() == 0.0


# ── 결합 커널의 옮겨적기 ──────────────────────────────────────────
def _full(fp, npfp):
    hs, invm, ip_idx, ip_par = load.scene(BASE)
    hb, bd_idx, bd_par = load.scene_bend(BASE)
    hm, sm_idx, sm_rest = SE.load_seam(SEAM)
    sh, sdata = CO.load_sdf(SDF)
    return hs, hb, invm, ip_idx, ip_par, bd_idx, bd_par, sm_idx, sm_rest, sh, sdata


@missing_full
@pytest.mark.parametrize("kind,flags,kdepth", [
    ("inplane", dict(use_ip=1, use_bd=0, use_sm=0, use_col=0), U.K_STRETCH_DEPTH_PER_CON),
    ("bend", dict(use_ip=0, use_bd=1, use_sm=0, use_col=0), U.K_BEND_DEPTH_PER_CON),
    ("dist", dict(use_ip=0, use_bd=0, use_sm=1, use_col=0), U.K_SEAM_DEPTH_PER_CON),
    ("collision", dict(use_ip=0, use_bd=0, use_sm=0, use_col=1), U.K_COLLIDE_DEPTH_PER_CON),
])
def test_full_kernel_matches_single_kernels(kind, flags, kdepth):
    """결합 커널을 **갈래 하나만 켜고** 1스텝 — 각 단일 커널의 v3 정답과 «같은 값»이어야 한다."""
    hs, hb, invm, ip_idx, ip_par, bd_idx, bd_par, sm_idx, sm_rest, sh, sdata = _full(ti.f32, np.float32)
    h, before, after = load.cell_step_kind(BASE, kind)
    g = h["G"] if kind == "collision" else 0.0
    ti.init(arch=GPU, default_fp=ti.f32)
    assert ti.lang.impl.current_cfg().arch == GPU
    fu = F.Full(before.astype(np.float32), np.zeros((hs["n"], 3), np.float32), invm.astype(np.float32),
                ip_idx, ip_par.astype(np.float32), hs["k"], bd_idx, bd_par.astype(np.float32), hb["ke"],
                sm_idx, sm_rest.astype(np.float32), sh, sdata, sh["THICK"], sh["MU"])
    p, _, _ = fu.step(1, 1, h["h"], g, 0.0, **flags)
    r = U.layer1(p.astype(np.float64) - after, after, kdepth, 1)
    assert (r <= 1).all(), f"{kind} 초과 정점 {(r > 1).sum()} · 최대 비 {r.max():.4f}"


@missing_full
def test_full_kernel_matches_v3_combined_step():
    """★ **순서까지** 검증한다 — 네 갈래를 «한꺼번에» 1스텝 돌려 v3 결합 정답과 대조.

    갈래별 대조는 **산술만** 보고 «순회 순서»를 못 본다. v3 의 순서는
    `garmentScene.ts:734` `[...inplane, ...bends, ...seamCons]` → 몸 충돌이고,
    가우스–자이델이라 **순서가 곧 결과**다.
    실측 — f32 **6.542450e-07**(비 0.0446 · K 합 123 = 53+24+12+34) · f64 **2.220446e-16**.
    """
    hs, hb, invm, ip_idx, ip_par, bd_idx, bd_par, sm_idx, sm_rest, sh, sdata = _full(ti.f32, np.float32)
    h, before, after = load.cell_step_kind(BASE, "all1")
    ti.init(arch=GPU, default_fp=ti.f32)
    assert ti.lang.impl.current_cfg().arch == GPU
    fu = F.Full(before.astype(np.float32), np.zeros((hs["n"], 3), np.float32), invm.astype(np.float32),
                ip_idx, ip_par.astype(np.float32), hs["k"], bd_idx, bd_par.astype(np.float32), hb["ke"],
                sm_idx, sm_rest.astype(np.float32), sh, sdata, sh["THICK"], sh["MU"])
    p, _, dg = fu.step(1, 1, h["h"], h["G"], 0.0)
    assert dg == 0
    ksum = (U.K_STRETCH_DEPTH_PER_CON + U.K_BEND_DEPTH_PER_CON
            + U.K_SEAM_DEPTH_PER_CON + U.K_COLLIDE_DEPTH_PER_CON)
    r = U.layer1(p.astype(np.float64) - after, after, ksum, 1)
    assert (r <= 1).all(), f"초과 정점 {(r > 1).sum()} · 최대 비 {r.max():.4f}"
