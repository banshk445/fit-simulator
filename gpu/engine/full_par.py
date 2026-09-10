"""v4-12 §1-③ — **«진짜» 병렬 커널**(함정 42 우회). `full_color2.py` 를 **상속**한다(재작성 0).

v4-11 이 값으로 보인 것(§1-④ㄹ · 함정 42): **`if` 안의 최상위 `for` 는 병렬 태스크가 되지 않는다** —
`full_color2.substep` 의 색 루프는 전부 `if use_ip != 0:` / `if use_bd != 0:` 안에 있어
**한 덩어리 `…_serial`(grid 1 × block 1)** 로 접혔다. 이 파일이 바꾸는 것은 **그 `if` 하나**다.

```
 ① 투영 산술 4종(`_p_inplane` · `_p_bend` · `_p_seam` · `_p_collide`)은 **한 줄도 다시 쓰지 않는다** —
    `full.Full` 의 `@ti.func` 를 그대로 물려받는다(물리 식 0줄 · §0-2).
 ② 색 분할(늘어남 8색 · 굽힘 14색)은 `full_color2.FullColor2.__init__` 의 것을 그대로 쓴다
    (`greedy_color` 재호출·재작성 0 · 순열도 같다).
 ③ 바뀐 것 = **런타임 `if` 를 없앤다**. `use_*` 갈래는 이 경로에서 «전부 켜짐» 하나뿐이고
    (제품 정의역 = `all`), 그래서 색 루프가 커널의 **최상위**에 선다.
    `ti.static(range(...))` 는 컴파일 때 펼쳐지므로 안쪽 `range` 루프가 곧 최상위 루프다.
 ④ 봉제만 `ti.loop_config(serialize=True)` 로 남긴다(v4-10·v4-09 와 «같은» 처분 · 정의역 밖).
 ★ 「병렬로 돌았는가」는 **믿지 않고 센다**(함정 42 규범 ①) — `gpu/par_probe.py` 가
   프로파일러 태스크 수 · `grid`/`block` · IR 의 `range_for` 를 **실행 «전»** 에 확인한다.
```
★ `from __future__ import annotations` 를 쓰지 않는다(v4-01 함정 2).
"""
import numpy as np
import taichi as ti

from .full_color2 import FullColor2


@ti.data_oriented
class FullPar(FullColor2):
    """`FullColor2` 와 **같은 색·같은 순열·같은 투영 식** · `if` 만 없다."""

    @ti.kernel
    def substep_par(self, h: float, h2: float, gravity: float, decay: float,
                    k: float, ke: float):
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
        for v in range(self.n):                                   # ⑥ 몸 충돌 — 정점 독립
            if self.invm[v] != 0.0:
                self._p_collide(v)
        for v in range(self.n):                                   # ⑦ 속도 갱신
            if self.invm[v] != 0.0:
                self.vel[v] = (self.pos[v] - self.prev[v]) / h * decay

    def n_tasks_expected(self):
        """코드에서 «센» 태스크 수(§0-4ㄹ) — 계기가 이 수와 대조한다."""
        return 1 + 3 + self.ip_colors + self.bd_colors + 1 + 1 + 1

    def step(self, frames, substeps, dt, gravity, damping,
             use_ip=1, use_bd=1, use_sm=1, use_col=1):
        if not (use_ip and use_bd and use_sm and use_col):
            raise ValueError("full_par 는 «전부 켜짐»(제품 정의역 all) 하나뿐이다 — "
                             "런타임 `if` 를 없앤 것이 이 파일의 전부다(§1-③)")
        self.degenerate[None] = 0
        h = dt / substeps
        h2 = h * h
        decay = float(np.exp(-damping * h))
        for _f in range(frames):
            for _s in range(substeps):
                self.substep_par(h, h2, gravity, decay, self.k, self.ke)
        ti.sync()
        return self.pos.to_numpy(), self.vel.to_numpy(), int(self.degenerate[None])
