"""v4-02 §2 — ② 옷 상태 로더 · ③ 늘어남 제약 이식을 **pytest** 로 고정한다.

문턱은 전부 **인용**이다 — 이 파일이 새로 정하는 수는 0이다.
  · ㄱ·ㄴ 상한 = **M × 4·ULP_f32(최대|좌표|)** (v4-02 §0-4 ③ · 4 ULP 규칙은 v3-87 등재)
  · ㄴ 는 그 상한을 **넘었다**(갈래 C). 문턱을 «옮기지 않고» `xfail(strict)` 로 **고정**한다 —
    통과로 바뀌면 pytest 가 «예상 밖 통과»로 알려 준다(함정 14: 결과에 맞춰 문턱 조정 금지).

대조 자산(`gpu/oracle/export/`)은 `scripts/v4Export.ts` · `v4Strip.ts` · `v4CellStep.ts` 가 낸다.
"""
import sys
from pathlib import Path

import numpy as np
import pytest
import taichi as ti

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from oracle import load  # noqa: E402
from engine import stretch as S  # noqa: E402

BASE = "c100-h170-s45_M"
GPU = ti.metal if sys.platform == "darwin" else ti.cuda
missing = pytest.mark.skipif(not (load.EXPORT / "cells.json").exists(),
                             reason="덤프 자산 없음 — scripts/v4Export.ts 를 먼저 돌린다")


def _gpu():
    ti.init(arch=GPU, default_fp=ti.f32)
    assert ti.lang.impl.current_cfg().arch == GPU, "조용한 arch 폴백(v4-01 함정 1)"


# ─── ② 옷 상태 로더 ───────────────────────────────────────────────
@missing
def test_cells_table_is_39():
    rows = load.cells_table()
    assert len(rows) == 39                                  # 정답지 «실효» 39칸(v4-01 §4-1 ㉣)
    assert {r["fabric"] for r in rows} == {"gray"}           # v3GridRun.ts:120
    assert {r["k"] for r in rows} == {69}                    # consts.ts FABRICS.gray.k
    assert {r["d"] for r in rows} == {0.009}                 # v3GridRun.ts:57 D_MM 기본 9
    assert all(r["inplane"] == r["tris"] for r in rows)      # 늘어남 제약 = 삼각형 «하나에 하나»


@missing
def test_blob_vertex_count_matches_assembly():
    """blob 헤더 n ↔ 오늘의 조립 n. **편입 36칸은 전량 일치**해야 한다.

    ★ 「보류」 3칸 중 **2칸은 불일치**한다(옛 조립의 산물 · 정본 sha 미등재) —
      v4-02 실측. 정점 대조에 쓸 수 있는 칸은 그래서 **37칸**이다.
    """
    idx = load.index()
    mis = []
    for r in load.cells_table():
        head, _, _ = load.cloth(r["id"])
        if head["n"] != r["n"]:
            mis.append(r["id"])
    assert all(not idx[c].get("sha") for c in mis), f"편입 칸이 불일치한다 — {mis}"
    assert sorted(mis) == ["c87.5-h155-s40_L", "c87.5-h155-s40_XL"]


@missing
def test_base_cell_scene():
    head, invm, idx, par = load.scene(BASE)
    assert head["n"] == 9388 and head["m"] == head["tris"] == 18016
    assert head["substeps"] == 229 and head["k"] == 69
    assert invm.shape == (9388,) and idx.shape == (18016, 3) and par.shape == (18016, 5)
    assert (par[:, 4] > 0).all()                             # area = |det|/2 > 0


# ─── ③ㄱ 합성 「한 줄 천」 ──────────────────────────────────────────
@missing
def test_strip_matches_v3():
    head, uv, tris, invm, pos3, _ = load.strip_v3()
    n = head["n"]
    pos0 = np.zeros((n, 3)); pos0[:, 0] = uv[:, 0]; pos0[:, 2] = uv[:, 1]
    idx, par = S.make_inplane(tris, uv, np.float32)
    inv, _ = S.assign_mass(n, tris, uv, head["rho"], pinned=head["pinned"], dtype=np.float32)
    _gpu()
    st = S.Stretch(pos0, np.zeros((n, 3)), inv, idx, par, head["k"])
    p4, _ = st.step(head["frames"], head["substeps"], head["DT"], head["G"], head["DAMP"])
    d = np.abs(p4.astype(np.float64) - pos3).max()
    mx = float(np.abs(pos3).max())
    assert d <= S.ulp_bound(mx, head["frames"])              # M = step() 호출 수 = 600(엄격한 쪽)


# ─── ③ㄴ 정답지 1칸 · 늘어남만 1스텝 ───────────────────────────────
def _cell_step(fp, npfp):
    hs, invm, idx, par = load.scene(BASE)
    hc, before, after = load.cell_step(BASE)
    n = hs["n"]
    ti.init(arch=GPU, default_fp=fp)
    assert ti.lang.impl.current_cfg().arch == GPU
    st = S.Stretch(before.astype(npfp), np.zeros((n, 3), npfp), invm.astype(npfp),
                   idx, par.astype(npfp), hs["k"], fp=fp)
    p4, _ = st.step(1, 1, hc["h"], 0.0, 0.0)
    return np.abs(p4.astype(np.float64) - after).max(), float(np.abs(before).max())


@missing
def test_cell_step_port_is_exact_in_f64():
    """**이식 자체가 옳은가** — 같은 커널을 f64 로 돌리면 v3 와 «수치적으로 같아야» 한다.

    이 시험이 통과하는 한 ㄴ 의 초과는 **알고리즘이 아니라 f32 폭**의 문제다(귀속을 가른다).
    """
    d, mx = _cell_step(ti.f64, np.float64)
    assert d <= 8.0 * np.spacing(mx)                         # f64 몇 ULP — 이식 동일성


@missing
@pytest.mark.xfail(strict=True, reason=(
    "v4-02 §4 **갈래 C** — 사전등록 상한 M×4·ULP_f32(M=1)=4.768e-07 을 5.837e-07 로 «1.224배» 넘는다. "
    "초과 좌표는 28,164 중 **1개**. 문턱은 옮기지 않는다(함정 14) — 처분은 전략 세션 몫."))
def test_cell_step_within_registered_bound_f32():
    d, mx = _cell_step(ti.f32, np.float32)
    assert d <= S.ulp_bound(mx, 1)
