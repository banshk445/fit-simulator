"""v4-06 §1-① — **봉제 제약 이식**. v3 의 패널 이음(거리 제약)을 Taichi 로 옮긴다.

v3 코드 사실(손으로 적지 않고 «인용»한다):
  · `src/v3/solver.ts:22-32` `DistanceConstraint` — 「거리 제약: **C = |xj − xi| − rest**,
    컴플라이언스 **α = 1/k** [k: N/m]」 (주석이 식을 그대로 적고 있다)
  · `src/v3/garmentScene.ts:715-726` `seams` — **10 이음**(어깨 L/R · 옆선 L/R · 암홀 앞뒤 L/R ·
    소매밑 L/R). 각 이음은 두 «정점 열»을 짝지은다(`row`/`col` 로 뜬다)
  · `src/v3/garmentScene.ts:728-730`
    `seamCons.push({ kind:'dist', i: sm.a[k], j: sm.b[k], rest: SEP, k: KMEM, lambda: 0 })`
    ⟹ **rest = `SEP` = 2×THICK = 2e-3 m** · **k = `KMEM` = 원단 k**(gray 69)
  · `src/v3/garmentScene.ts:734` `cons = [...inplane, ...bends, ...seamCons]`
    ⟹ **봉제는 순회의 «맨 뒤»** 다(가우스–자이델 순서에 들어간다)
  · `src/v3/solver.ts:1145` `projectDistance` —
      `len = hypot(...)` · **`len < 1e-12` 이면 그냥 돌아온다** · 방향 `d̂ = (xj−xi)/len` ·
      `wsum = wi + wj` · **`wsum === 0` 이면 돌아온다** · `C = len − rest` ·
      **`at = 1/c.k/h2`**(α̃ = α/h² · α = 1/k) · `dl = (−C − at·λ)/(wsum + at)` · `λ += dl` ·
      **`pos[i] −= wi·dl·d̂`** · **`pos[j] += wj·dl·d̂`**
  · `src/v3/solver.ts:1084` 반복수 **1** · λ 는 **서브스텝마다 0**

★ **램프 주의(값으로 확인함)** — `dressRun.prepare` 의 `setRest(f)` 는 봉제 `rest` 를 `rest0 → SEP`
  로 당긴다. 이 판은 **정착 상태에서 시작**하고 `setRest` 를 부르지 않으므로 `rest` 는 생성값이다.
  실측: **rest 최소 = 최대 = 2.000000e-03 = SEP** · `RAMP_N = 79 < 180`(정착 프레임) ⟹
  **정착 시점의 값과 같다**(가정 0 · v4-06 §1-① 실측).
★ `Math.hypot` 부재 — `sqrt(Σx²)` 로 옮긴다(상대차 2.584e-16 · f32 ULP 보다 9자릿수 작다).
★ `from __future__ import annotations` 를 쓰지 않는다(v4-01 함정 2).
"""
import json
import struct
from pathlib import Path

import numpy as np
import taichi as ti

EPS_LEN = 1e-12      # solver.ts:1151 — 길이 퇴화 문턱(인용)


def load_seam(path):
    """`scripts/v4Export.ts` 가 쓴 봉제 장면 → (헤더, idx i32[ms,2], rest f64[ms])."""
    raw = Path(path).read_bytes()
    (hlen,) = struct.unpack_from("<I", raw, 0)
    head = json.loads(raw[4:4 + hlen].decode("utf-8"))
    ms = int(head["ms"])
    idx = np.frombuffer(raw, dtype="<i4", count=ms * 2, offset=4 + hlen).reshape(ms, 2)
    rest = np.frombuffer(raw, dtype="<f8", count=ms, offset=4 + hlen + ms * 2 * 4)
    return head, idx, rest


@ti.data_oriented
class Seam:
    """봉제(거리) 제약만 도는 솔버. 담지 «않는» 것: 늘어남 · 굽힘 · 충돌 · 자기충돌."""

    def __init__(self, pos, vel, invm, idx, rest, k, fp=ti.f32):
        np_fp = np.float64 if fp == ti.f64 else np.float32
        self.fp, self.np_fp = fp, np_fp
        self.n = int(pos.shape[0])
        self.ms = int(idx.shape[0])
        self.pos = ti.Vector.field(3, fp, shape=self.n)
        self.prev = ti.Vector.field(3, fp, shape=self.n)
        self.vel = ti.Vector.field(3, fp, shape=self.n)
        self.invm = ti.field(fp, shape=self.n)
        self.idx = ti.Vector.field(2, ti.i32, shape=self.ms)
        self.rest = ti.field(fp, shape=self.ms)
        self.lam = ti.field(fp, shape=self.ms)
        self.pos.from_numpy(np.ascontiguousarray(pos, dtype=np_fp))
        self.vel.from_numpy(np.ascontiguousarray(vel, dtype=np_fp))
        self.invm.from_numpy(np.ascontiguousarray(invm, dtype=np_fp))
        self.idx.from_numpy(np.ascontiguousarray(idx, dtype=np.int32))
        self.rest.from_numpy(np.ascontiguousarray(rest, dtype=np_fp))
        self.k = float(k)

    @ti.func
    def _project(self, t, h2, k):
        """`solver.ts:1145 projectDistance` 의 이식."""
        i, j = self.idx[t][0], self.idx[t][1]
        dv = self.pos[j] - self.pos[i]
        ln = ti.sqrt(dv.dot(dv))                     # v3 는 hypot — 차 2.58e-16
        if ln >= EPS_LEN:
            dh = dv / ln
            wi, wj = self.invm[i], self.invm[j]
            wsum = wi + wj
            if wsum != 0.0:
                C = ln - self.rest[t]
                at = 1.0 / k / h2                    # α̃ = α/h² · α = 1/k
                dl = (-C - at * self.lam[t]) / (wsum + at)
                self.lam[t] = self.lam[t] + dl
                self.pos[i] -= wi * dl * dh
                self.pos[j] += wj * dl * dh

    @ti.kernel
    def run(self, frames: ti.i32, substeps: ti.i32, dt: float,
            gravity: float, damping: float, k: float):
        """`solver.ts:1050 step()` 의 프레임 루프. **전부 직렬** — 가우스–자이델 순서를 지킨다."""
        ti.loop_config(serialize=True)
        for _ in range(1):
            h = dt / substeps
            h2 = h * h
            decay = ti.exp(-damping * h)
            for _f in range(frames):
                for _sub in range(substeps):
                    for v in range(self.n):
                        self.prev[v] = self.pos[v]
                        if self.invm[v] != 0.0:
                            self.vel[v][1] -= gravity * h
                            self.pos[v] += self.vel[v] * h
                    for t in range(self.ms):
                        self.lam[t] = 0.0
                    for t in range(self.ms):
                        self._project(t, h2, k)
                    for v in range(self.n):
                        if self.invm[v] != 0.0:
                            self.vel[v] = (self.pos[v] - self.prev[v]) / h * decay

    def step(self, frames, substeps, dt, gravity, damping):
        self.run(frames, substeps, dt, gravity, damping, self.k)
        ti.sync()
        return self.pos.to_numpy(), self.vel.to_numpy()
