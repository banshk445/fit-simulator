"""v4-10 §1-④ — **늘어남 «과» 굽힘을 «둘 다» 색 분할한 판**. `full.py` 를 고치지 않고 «상속»한다.

v4-09 의 `full_color.py`(늘어남만)는 **바이트 한 개도 안 바꾼다** — 이 파일은 «새 경로»다.
컬러링 함수는 `full_color.greedy_color` 를 **그대로 import** 한다(재작성 0).

★ 투영 산술 4종(`_p_inplane` · `_p_bend` · `_p_seam` · `_p_collide`)은 **한 줄도 다시 쓰지 않았다** —
  `F.Full` 의 것을 그대로 물려받는다. 바뀐 것은 **«무엇을 언제 동시에 도느냐»** 하나뿐이다.

```
 ① 늘어남 — 탐욕 컬러링 **8색**(v4-09 실측 · 이 판에서 재현)
 ② 굽힘   — 탐욕 컬러링 **14색**(v4-10 §1-③ 실측). 같은 색 안에서는 네 정점이 겹치지 않는다
            ⟹ 동시 갱신해도 가우스–자이델과 «같은 결과»(쓰기 충돌이 원리적으로 0)
 ③ 봉제   — **직렬 그대로**(이 판의 정의역 밖 · §0-5)
 ④ 예측 · 몸 충돌 · 속도 갱신 — 정점별 독립 ⟹ 병렬(읽고 쓰는 자리가 v 하나)
 ★ 색 «사이»는 여전히 순차다. **순수 Jacobi 아니다**(v3 에서 발산 실측 · `solver.ts:627-635`).
 ★ 색 순서는 v3 의 배열 순서와 «다르다» ⟹ 직렬판과 결과가 갈릴 수 있다. 그 크기를 재는 것이 §1-④.
```
★ `from __future__ import annotations` 를 쓰지 않는다(v4-01 함정 2).
"""
import numpy as np
import taichi as ti

from . import full as F
from .full_color import greedy_color


def _bounds(idx, n):
    """색을 «연속»이 되게 재배열하고 (순열, 색 경계, 색별 크기)를 낸다."""
    col = greedy_color(np.asarray(idx, np.int32), n)
    order = np.argsort(col, kind="stable")
    col = col[order]
    nc = int(col.max()) + 1
    cnt = np.bincount(col, minlength=nc)
    ends = np.cumsum(cnt)
    return (order,
            tuple((int(ends[c] - cnt[c]), int(ends[c])) for c in range(nc)),
            [int(x) for x in cnt])


@ti.data_oriented
class FullColor2(F.Full):
    def __init__(self, pos, vel, invm, ip_idx, ip_par, k, bd_idx, bd_par, ke,
                 sm_idx, sm_rest, sdf_head, sdf_data, thickness, mu, fp=ti.f32):
        n = int(pos.shape[0])
        ip_ord, self.ip_bounds, self.ip_sizes = _bounds(ip_idx, n)
        bd_ord, self.bd_bounds, self.bd_sizes = _bounds(bd_idx, n)
        self.ip_colors, self.bd_colors = len(self.ip_bounds), len(self.bd_bounds)
        self.ip_perm, self.bd_perm = ip_ord, bd_ord
        super().__init__(pos, vel, invm,
                         np.asarray(ip_idx)[ip_ord], np.asarray(ip_par)[ip_ord], k,
                         np.asarray(bd_idx)[bd_ord], np.asarray(bd_par)[bd_ord], ke,
                         sm_idx, sm_rest, sdf_head, sdf_data, thickness, mu, fp=fp)

    @ti.kernel
    def substep(self, h: float, h2: float, gravity: float, decay: float, k: float, ke: float,
                use_ip: ti.i32, use_bd: ti.i32, use_sm: ti.i32, use_col: ti.i32):
        for v in range(self.n):                                   # ① 예측 — 병렬(정점 독립)
            self.prev[v] = self.pos[v]
            if self.invm[v] != 0.0:
                self.vel[v][1] -= gravity * h
                self.pos[v] += self.vel[v] * h
        for t in range(self.mi):                                  # ② λ 초기화 — 병렬
            self.ip_lam[t] = ti.Vector([0.0, 0.0, 0.0])
        for t in range(self.mb):
            self.bd_lam[t] = 0.0
        for t in range(self.ms):
            self.sm_lam[t] = 0.0
        if use_ip != 0:                                           # ③ 늘어남 — 색마다 병렬
            for ci in ti.static(range(len(self.ip_bounds))):
                for t in range(self.ip_bounds[ci][0], self.ip_bounds[ci][1]):
                    self._p_inplane(t, h2, k, k, k)
        if use_bd != 0:                                           # ④ 굽힘 — 색마다 병렬
            for ci in ti.static(range(len(self.bd_bounds))):
                for t in range(self.bd_bounds[ci][0], self.bd_bounds[ci][1]):
                    self._p_bend(t, h2, ke)
        if use_sm != 0:                                           # ⑤ 봉제 — 직렬(그대로)
            ti.loop_config(serialize=True)
            for t in range(self.ms):
                self._p_seam(t, h2, k)
        if use_col != 0:                                          # ⑥ 몸 충돌 — 병렬(정점 독립)
            for v in range(self.n):
                if self.invm[v] != 0.0:
                    self._p_collide(v)
        for v in range(self.n):                                   # ⑦ 속도 갱신 — 병렬
            if self.invm[v] != 0.0:
                self.vel[v] = (self.pos[v] - self.prev[v]) / h * decay

    def step(self, frames, substeps, dt, gravity, damping,
             use_ip=1, use_bd=1, use_sm=1, use_col=1):
        self.degenerate[None] = 0
        h = dt / substeps
        h2 = h * h
        decay = float(np.exp(-damping * h))
        for _f in range(frames):
            for _s in range(substeps):
                self.substep(h, h2, gravity, decay, self.k, self.ke,
                             int(use_ip), int(use_bd), int(use_sm), int(use_col))
        ti.sync()
        return self.pos.to_numpy(), self.vel.to_numpy(), int(self.degenerate[None])
