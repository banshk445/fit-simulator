"""v4-04 §0 — **백엔드 능력을 «값으로» 확인한다**(추정 0).

맥 Metal 재실행에서 f64 참조 시험 5건이 이렇게 떨어졌다:
  `RuntimeError [spirv_ir_builder.cpp:299] Type f64 not supported`
**Metal 백엔드는 f64 커널을 못 띄운다.** 기계 제약이고 **이식 결함이 아니다** —
같은 시험이 2호기 CUDA 에서는 통과한다.

처분(v4-04 §0 등재): f64 참조 시험은 **백엔드가 f64 를 지원하지 않으면 `skip`** 한다.
사유 문자열에 **백엔드명과 오류 원문 요약**을 싣는다 — **통과로 위장하지 않는다.**
⟹ **f64 참조 시험의 정본 기계는 2호기(CUDA)뿐이고 Metal 은 f32 전용이다.**
"""
import sys

import pytest
import taichi as ti

GPU_NAME = "metal" if sys.platform == "darwin" else "cuda"
GPU = ti.metal if sys.platform == "darwin" else ti.cuda


def _probe_f64():
    """f64 커널을 실제로 «띄워 본다». 추정하지 않는다."""
    try:
        ti.init(arch=GPU, default_fp=ti.f64)
        if ti.lang.impl.current_cfg().arch != GPU:
            return False, f"{GPU_NAME}: 조용한 arch 폴백(v4-01 함정 1)"
        f = ti.field(ti.f64, shape=1)

        @ti.kernel
        def k():
            f[0] = 1.0

        k()
        ti.sync()
        return True, ""
    except Exception as e:
        first = str(e).strip().splitlines()[0][:160] if str(e).strip() else ""
        return False, f"{type(e).__name__}: {first}"


F64_OK, F64_WHY = _probe_f64()

needs_f64 = pytest.mark.skipif(
    not F64_OK,
    reason=(f"백엔드 **{GPU_NAME}** 가 f64 커널을 못 띄운다 — {F64_WHY} · "
            "기계 제약이지 이식 결함이 아니다(같은 시험이 2호기 CUDA 에서 통과). "
            "f64 참조 시험의 정본 기계 = 2호기(CUDA)뿐(v4-04 §0)"),
)
