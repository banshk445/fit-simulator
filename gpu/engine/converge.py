"""v4-04 §1-② — **층2(수렴 도달)의 v4 쪽 루프**.

**궤적을 보지 않는다.** `N_WIN` 프레임씩 돌리고 **창 순변위**만 확인하다가 문턱을 만나면 멈춘다.
판정식은 전부 v3 인용이다(새 수 0):
  · `dressRun.ts:N_WIN`  = round(1/(DAMP·DT)) ⟹ 10 · `s4Gate.ts:settleNetM` = `TOL_SELF` = 1e-4 m
  · 창 순변위 = `max_v |pos_v − ref_v|`(창 시작 `ref` 대비 · 정점 최대) — `runFrames` 의 그 식
"""
import numpy as np
import taichi as ti


def run_to_convergence(solver, n_win, tol, substeps, dt, gravity, damping, cap):
    """(최종 위치, 수렴 프레임, 마지막 창 순변위, 수렴 여부, 자취)."""
    ref = solver.pos.to_numpy().astype(np.float64)
    frame, net, converged, trail = 0, float("inf"), False, []
    while frame < cap:
        out = solver.step(n_win, substeps, dt, gravity, damping)
        pos = out[0].astype(np.float64)
        frame += n_win
        net = float(np.linalg.norm(pos - ref, axis=1).max())
        if len(trail) < 6 or frame % (n_win * 50) == 0:
            trail.append((frame, net))
        if net <= tol:
            converged = True
            break
        ref = pos
    ti.sync()
    return solver.pos.to_numpy().astype(np.float64), frame, net, converged, trail
