"""v4-14 §1-③ — **셀프 충돌을 포함한 «전 정의역» 결합 솔버**. `full_par.FullPar` 를 상속한다.

```
 ① 투영 산술 4종(`_p_inplane` · `_p_bend` · `_p_seam` · `_p_collide`)은 **한 줄도 다시 쓰지 않는다** —
    `full.Full` 의 `@ti.func` 를 그대로 물려받는다(물리 식 0줄 · §0-3).
 ② 색 분할(8색/14색)과 순열도 `FullColor2.__init__` 의 것을 그대로 쓴다(`FullPar` 를 통해).
 ③ 바뀐 것 = **한 서브스텝을 두 커널로 «가른다»** — 셀프 충돌이 그 «사이»에 서기 때문이다.
    자리는 v3 가 정한다(`solver.ts:1117-1122` — 제약 투영 «뒤» · 몸 충돌 «앞»).
      substep_a = ① 예측 · ② λ 초기화 · ③ 늘어남 · ④ 굽힘 · ⑤ 봉제   (full_par 의 ①~⑤ 그대로)
      〔셀프 충돌 = `selfcol.SelfCol.apply()`〕
      substep_b = ⑥ 몸 충돌 · ⑦ 속도 갱신                              (full_par 의 ⑥⑦ 그대로)
    ★ 가르는 것은 **연산 순서를 바꾸지 않는다** — 같은 순서를 두 커널에 나눠 담았을 뿐이다.
 ④ `full_par.py` 는 **바이트 불변**(§0-3) — 이 파일은 «새 파일»이다.
```
★ `from __future__ import annotations` 를 쓰지 않는다(v4-01 함정 2).
"""
import numpy as np
import taichi as ti

from .full_par import FullPar
from .selfcol import SelfCol


@ti.data_oriented
class FullSC(FullPar):
    def __init__(self, *a, **kw):
        tris = kw.pop("tris")
        sc_kw = kw.pop("sc_kw", {})
        super().__init__(*a, **kw)
        self.sc = SelfCol(self.pos, self.invm, tris, self.thickness, fp=self.fp, **sc_kw)
        self.sc_stat = dict(pairs=0, cons=0, applied=0, maxpen=0.0)

    @ti.kernel
    def substep_a(self, h: float, h2: float, gravity: float, k: float, ke: float):
        for v in range(self.n):                                   # ① 예측 — 정점 독립
            self.prev[v] = self.pos[v]
            if self.invm[v] != 0.0:
                self.vel[v][1] -= gravity * h
                self.pos[v] += self.vel[v] * h
        for t in range(self.mi):                                  # ② λ 초기화
            self.ip_lam[t] = ti.Vector([0.0, 0.0, 0.0])
        for t in range(self.mb):
            self.bd_lam[t] = 0.0
        for t in range(self.ms):
            self.sm_lam[t] = 0.0
        for ci in ti.static(range(len(self.ip_bounds))):          # ③ 늘어남 — 색마다 «최상위»
            for t in range(self.ip_bounds[ci][0], self.ip_bounds[ci][1]):
                self._p_inplane(t, h2, k, k, k)
        for ci in ti.static(range(len(self.bd_bounds))):          # ④ 굽힘 — 색마다 «최상위»
            for t in range(self.bd_bounds[ci][0], self.bd_bounds[ci][1]):
                self._p_bend(t, h2, ke)
        ti.loop_config(serialize=True)                            # ⑤ 봉제 — 직렬 그대로
        for t in range(self.ms):
            self._p_seam(t, h2, k)

    @ti.kernel
    def substep_b(self, h: float, decay: float):
        for v in range(self.n):                                   # ⑥ 몸 충돌 — 정점 독립
            if self.invm[v] != 0.0:
                self._p_collide(v)
        for v in range(self.n):                                   # ⑦ 속도 갱신
            if self.invm[v] != 0.0:
                self.vel[v] = (self.pos[v] - self.prev[v]) / h * decay

    def n_tasks_expected(self):
        """substep_a(1 + 3 + 8 + 14 + 1) + substep_b(1 + 1) = 29 — `full_par` 와 «같은 수»."""
        return (1 + 3 + self.ip_colors + self.bd_colors + 1) + (1 + 1)

    def step(self, frames, substeps, dt, gravity, damping,
             use_ip=1, use_bd=1, use_sm=1, use_col=1, order="v3"):
        if not (use_ip and use_bd and use_sm and use_col):
            raise ValueError("full_sc 는 «전부 켜짐»(제품 정의역 all + 셀프 충돌) 하나뿐이다")
        self.degenerate[None] = 0
        h = dt / substeps
        h2 = h * h
        decay = float(np.exp(-damping * h))
        acc = dict(pairs=0, cons=0, applied=0, maxpen=0.0, calls=0)
        for _f in range(frames):
            for _s in range(substeps):
                self.substep_a(h, h2, gravity, self.k, self.ke)
                st = self.sc.apply(order=order)                   # 자리 = solver.ts:1117-1122
                self.substep_b(h, decay)
                acc["pairs"] += st["pairs"]
                acc["cons"] += st["cons"]
                acc["applied"] += st["applied"]
                acc["maxpen"] = max(acc["maxpen"], st["maxpen"])
                acc["calls"] += 1
        ti.sync()
        self.sc_stat = acc
        return self.pos.to_numpy(), self.vel.to_numpy(), int(self.degenerate[None])
