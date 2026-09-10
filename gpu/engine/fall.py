"""v4-01 §1-③ — **한 정점 낙하**. v3 적분기를 그대로 옮긴 «가장 작은» 조각이다.

v3 코드 사실(손으로 적지 않고 인용한다):
  · `src/v3/consts.ts:3`      `G  = 9.81`
  · `src/v3/consts.ts:4`      `DT = 1 / 60`
  · `src/v3/solver.ts:1050`   `const h = p.dt / p.substeps;`
  · `src/v3/solver.ts:1061`   `s.vel[o + 1] -= p.gravity * h;`
  · `src/v3/solver.ts:1069`   `s.pos[o + 1] += s.vel[o + 1] * h;`
⟹ **semi-implicit(symplectic) Euler**. 정지에서 N 스텝 뒤의 **정확한 이산해**는
     v_N = −g·h·N          y_N = y0 − g·h²·N(N+1)/2
   연속 해석해 `y = y0 − ½g t²`(t = N·h)와는 **g·h²·N/2 만큼** 다르다 —
   그것은 «반올림»이 아니라 **적분 방식 자체의 편차**다. 둘을 갈라서 잰다.
"""
# ★ `from __future__ import annotations` 를 **쓰지 않는다** — 그것을 켜면 주석이 «문자열»이 되고
#   Taichi 커널이 인자 타입을 못 읽는다(`TaichiSyntaxError: Invalid type annotation`). 실측 확인분.
import taichi as ti


def v3_consts():
    """`src/v3/consts.ts` 에서 **읽어온다**(손 상수 0)."""
    from pathlib import Path
    import re
    src = (Path(__file__).resolve().parents[2] / "src" / "v3" / "consts.ts").read_text(encoding="utf-8")
    g = float(re.search(r"export const G = ([\d.]+);", src).group(1))
    dt_m = re.search(r"export const DT = ([\d.]+) / ([\d.]+);", src)
    dt = float(dt_m.group(1)) / float(dt_m.group(2))
    return g, dt


def fall(arch, n_steps: int, substeps: int, y0: float = 1.0):
    """Taichi 로 N 스텝 낙하시키고 (y, v) 를 f32 로 돌려준다. 백엔드는 인자로 받는다."""
    g, dt = v3_consts()
    h = dt / substeps
    ti.init(arch=arch, default_fp=ti.f32)
    got = ti.lang.impl.current_cfg().arch
    if got != arch:
        raise RuntimeError(f"요청 arch {arch} 인데 실제 {got} — 조용한 폴백(#121 계열)")
    pos = ti.field(ti.f32, shape=1)
    vel = ti.field(ti.f32, shape=1)
    pos[0] = y0
    vel[0] = 0.0

    @ti.kernel
    def step(gg: ti.f32, hh: ti.f32):
        for i in pos:                      # 정점 하나 — v3 의 정점 루프와 «같은 순서»
            vel[i] -= gg * hh              # solver.ts:1061
            pos[i] += vel[i] * hh          # solver.ts:1069

    for _ in range(n_steps):
        step(g, h)
    ti.sync()
    return float(pos[0]), float(vel[0])


def exact_discrete(n_steps: int, substeps: int, y0: float = 1.0):
    """같은 스킴의 **정확한 이산해**(부동소수 반올림만 남긴다)."""
    g, dt = v3_consts()
    h = dt / substeps
    return y0 - g * h * h * n_steps * (n_steps + 1) / 2.0, -g * h * n_steps


def exact_continuous(n_steps: int, substeps: int, y0: float = 1.0) -> float:
    """연속 해석해 `y = y0 − ½ g t²`."""
    g, dt = v3_consts()
    h = dt / substeps
    t = n_steps * h
    return y0 - 0.5 * g * t * t


def ulp_bound(y: float, n_steps: int) -> float:
    """누적 반올림 상한 = N × 4·ULP_f32(|y|) — **손 상수 0**(4 ULP 규칙은 v3-87 등재)."""
    import math
    if y == 0:
        return 0.0
    return n_steps * 4.0 * (2.0 ** (math.floor(math.log2(abs(y))) - 23))
