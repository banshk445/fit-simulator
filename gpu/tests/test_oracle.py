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


# v4-02 §1-① — **기계마다 되는 백엔드가 다르다**. 이름을 손으로 적지 않고 «플랫폼에서» 고른다:
#   에어 M4(darwin) → metal · 2호기(win32 · CUDA) → cuda. cpu 는 둘 다 있다.
GPU_ARCH = "metal" if sys.platform == "darwin" else "cuda"


def _arch(name):
    import taichi as ti
    return {"metal": ti.metal, "cuda": ti.cuda, "cpu": ti.cpu}[name]


@pytest.mark.parametrize("arch_name", [GPU_ARCH, "cpu"])
def test_single_vertex_fall(arch_name):
    arch = _arch(arch_name)
    N, SUB = 600, 8
    y, v = F.fall(arch, N, SUB)
    yd, vd = F.exact_discrete(N, SUB)
    # 문턱 = N × 4·ULP_f32(|y|) — 4 ULP 규칙은 v3-87 등재(손 상수 0)
    assert abs(y - yd) <= F.ulp_bound(y, N)
    assert abs(v - vd) <= F.ulp_bound(v, N)


def test_backends_agree():
    """GPU 백엔드 ↔ cpu 가 같은 값을 내는가. v4-01 은 metal↔arm64 가 **비트 동일**이었다."""
    N, SUB = 600, 8
    yg, _ = F.fall(_arch(GPU_ARCH), N, SUB)
    yc, _ = F.fall(_arch("cpu"), N, SUB)
    assert abs(yg - yc) <= F.ulp_bound(yg, N)


def test_fall_matches_v4_01_registered():
    """v4-01 §1-③′ 등재값과의 대조 — **기계가 바뀌어도 같은 수**여야 한다(이식의 첫 기준선).

    등재 원문: y = −6.676847458 · v = −12.262486 · 이산해 대비 −1.152e-05(상한 1.144e-03).
    표기 자릿수까지만 비교한다 — 노트가 «반올림해» 실었기 때문이다(비트 대조는 아니다).
    """
    N, SUB = 600, 8
    y, v = F.fall(_arch(GPU_ARCH), N, SUB)
    yd, _ = F.exact_discrete(N, SUB)
    assert round(y, 9) == -6.676847458          # v4-01 등재 표기
    assert round(v, 6) == -12.262486            # v4-01 등재 표기
    assert abs(y - yd) <= F.ulp_bound(y, N)
