"""v4-09 §1-③ — **병렬화 «소규모 시험»판**. `full.py` 를 **고치지 않고 «상속»한다**.

★ 투영 산술 4종(`_p_inplane` · `_p_bend` · `_p_seam` · `_p_collide`)은 **한 줄도 다시 쓰지 않았다** —
  `F.Full` 의 것을 그대로 물려받는다. 바뀐 것은 **«무엇을 언제 동시에 도느냐»** 하나뿐이다.

바뀐 것 (전부 «순서» 이야기다):
```
 ① 늘어남 — **탐욕 그래프 컬러링**으로 색을 나눈다(같은 색 = 정점을 공유하지 않는다) ⟹
    같은 색 «안»에서는 동시 갱신해도 **가우스–자이델과 같은 결과**다(쓰기 충돌이 원리적으로 0).
    색 «사이»는 여전히 순차다. **순수 Jacobi 아니다**(v3 에서 발산 실측 · `solver.ts:627-635`).
    ⟹ 다만 **색 순서는 v3 의 배열 순서와 다르다** — 그래서 직렬판과 결과가 «갈릴 수 있다».
       그 갈림의 크기를 재는 것이 §1-③ㄴ 이다.
 ② 굽힘·봉제 — **직렬 그대로**(이 판은 「늘어남만」 색 분할한다 · §0-6).
 ③ 예측 · 몸 충돌 · 속도 갱신 — **정점별로 서로 독립**이다(읽고 쓰는 자리가 v 하나뿐) ⟹
    동시에 돌려도 **비트 동일**하다. 순서 문제가 아니라서 색이 필요 없다.
```
★ `from __future__ import annotations` 를 쓰지 않는다(v4-01 함정 2).
"""
import numpy as np
import taichi as ti

from . import full as F


def greedy_color(idx, n):
    """탐욕 그래프 컬러링 — 제약을 «원래 순서대로» 훑으며 이웃이 안 쓴 가장 작은 색을 준다.

    이웃 = 정점을 하나라도 공유하는 제약. 손 상수 0(색 수는 «결과»이지 입력이 아니다).
    """
    m = idx.shape[0]
    color = np.full(m, -1, np.int32)
    vcol = [[] for _ in range(n)]          # 정점 v 에 이미 걸린 색들
    for t in range(m):
        used = set()
        for v in idx[t]:
            used.update(vcol[v])
        c = 0
        while c in used:
            c += 1
        color[t] = c
        for v in idx[t]:
            vcol[v].append(c)
    return color


@ti.data_oriented
class FullColor(F.Full):
    def __init__(self, pos, vel, invm, ip_idx, ip_par, k, bd_idx, bd_par, ke,
                 sm_idx, sm_rest, sdf_head, sdf_data, thickness, mu, fp=ti.f32):
        n = int(pos.shape[0])
        col = greedy_color(np.asarray(ip_idx, np.int32), n)
        order = np.argsort(col, kind="stable")           # 색이 «연속»이 되게 재배열
        self.color = col[order]
        nc = int(self.color.max()) + 1
        cnt = np.bincount(self.color, minlength=nc)
        ends = np.cumsum(cnt)
        self.bounds = tuple((int(ends[c] - cnt[c]), int(ends[c])) for c in range(nc))
        self.ncolors = nc
        self.color_sizes = [int(x) for x in cnt]
        self.perm = order
        super().__init__(pos, vel, invm,
                         np.asarray(ip_idx)[order], np.asarray(ip_par)[order], k,
                         bd_idx, bd_par, ke, sm_idx, sm_rest,
                         sdf_head, sdf_data, thickness, mu, fp=fp)

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
            for ci in ti.static(range(len(self.bounds))):
                for t in range(self.bounds[ci][0], self.bounds[ci][1]):
                    self._p_inplane(t, h2, k, k, k)
        if use_bd != 0:                                           # ④ 굽힘 — 직렬(그대로)
            ti.loop_config(serialize=True)
            for t in range(self.mb):
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
