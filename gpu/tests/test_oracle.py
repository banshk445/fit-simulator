"""v4-01 §1-④ — ② 정답지 로더 · ③ 한 정점 낙하를 **pytest** 로 고정한다.

문턱은 전부 **인용**이다 — 이 파일이 새로 정하는 수는 0이다.
"""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from oracle import load  # noqa: E402
from engine import fall as F  # noqa: E402

BASE = "c100-h170-s45_M"          # 기본몸 M 정본(v3-49 · v3-91 정본에 등재)


def test_base_cell_matches_registered():
    head, state, sha = load.cloth(BASE)
    reg = load.index()[BASE]
    assert head["n"] == 9388                       # v3-91 §1-④ 등재
    assert sha.startswith("9d3b07e4")              # 상태 sha(페이로드) — v3-49 규칙
    assert sha == reg["sha"]                       # 인덱스와 일치
    assert head["frame"] == reg["f"]
    assert len(state) == head["n"] * 6             # 위치 3n + 속도 3n


def test_base_body_height():
    y = load.body("c100-h170-s45")[:, 1]
    assert abs(float(y.max() - y.min()) - 1.70) <= 0.0020   # v3-82 등재 범위 인용


def test_all_27_bodies_load():
    ids = sorted({k.rsplit("_", 1)[0] for k in load.index()})
    assert len(ids) == 27
    for i in ids:
        v = load.body(i)
        assert v.ndim == 2 and v.shape[1] == 3 and v.shape[0] > 0
        assert len(load.body_sha(i)) == 64


def test_provide_list_is_35():
    assert len(load.provide()) == 35               # v3-91 정본


@pytest.mark.parametrize("arch_name", ["metal", "cpu"])
def test_single_vertex_fall(arch_name):
    import taichi as ti
    arch = {"metal": ti.metal, "cpu": ti.cpu}[arch_name]
    N, SUB = 600, 8
    y, v = F.fall(arch, N, SUB)
    yd, vd = F.exact_discrete(N, SUB)
    # 문턱 = N × 4·ULP_f32(|y|) — 4 ULP 규칙은 v3-87 등재(손 상수 0)
    assert abs(y - yd) <= F.ulp_bound(y, N)
    assert abs(v - vd) <= F.ulp_bound(v, N)


def test_backends_agree():
    import taichi as ti
    N, SUB = 600, 8
    ym, _ = F.fall(ti.metal, N, SUB)
    yc, _ = F.fall(ti.cpu, N, SUB)
    assert abs(ym - yc) <= F.ulp_bound(ym, N)
