"""v4-05 §1-③ — **몸 충돌 이식**. v3 의 격자 SDF 질의 + 밀어내기 + 쿨롱 마찰을 Taichi 로 옮긴다.

v3 코드 사실(손으로 적지 않고 «인용»한다):
  · `src/v3/bodySdf.ts:246` `sampleSdf` — **삼선형 보간**. 격자 «밖»이면 `g.band` 를 돌려준다
    (⟹ d ≥ 0 이라 해소가 «아무 일도 안 한다» — 흡착 0 · 외삽 0)
    `at(a,b,c) = g.data[(c*ny + b)*nx + a]` · `data` 는 **Float32Array** 다
  · `src/v3/solver.ts:126` `sdf(kind='grid')` — 법선은 **중심차분**, 간격은 **`e = g.h`**(격자 간격 그대로)
    `l = hypot(gx,gy,gz)` · `l < 1e-20` 이면 법선 **(0,1,0)**
  · `src/v3/solver.ts:199` `resolveCollisions` —
      `d = sdf(...) − thickness` · **`d ≥ 0` 이면 continue**(밖이면 손대지 않는다 · 흡착 0)
      `depth = −d` · **`pos += depth·n`**(법선 방향으로 «밀어낸다»)
      마찰: 접선 변위 `t = (pos − prev)` 에서 법선 성분을 뺀 것 · `k = min(1, μ·depth/|t|)` ·
            **`pos −= t·k`** · `|t| > 1e-15` 일 때만(정지/운동 마찰을 따로 두지 않는다)
  · `src/v3/consts.ts` `THICK = 1e-3` · `MU = 0.3`
  · `src/v3/dressRun.ts:prepare` 가 `collision = { colliders:[{kind:'grid', g: bodyG}], thickness: THICK, mu: MU }`

★ v3 와 «다를 수밖에 없는» 자리 — `Math.hypot`. Taichi 에 없어 `sqrt(Σx²)` 를 쓴다.
  상대차 **2.584e-16**(v4-03 실측 · f32 ULP 1.19e-07 보다 9 자릿수 작다) ⟹ f32 판정에 무관.
★ 격자 `data` 는 **f32 로 둔다** — v3 도 `Float32Array` 다. 계산만 `fp`(f32/f64) 로 올린다.
★ `from __future__ import annotations` 를 쓰지 않는다(v4-01 함정 2).
"""
import json
import struct
from pathlib import Path

import numpy as np
import taichi as ti

EPS_N = 1e-20      # solver.ts:136 — 법선 길이 퇴화 문턱(인용)
EPS_T = 1e-15      # solver.ts:238 — 접선 변위 문턱(인용)


def load_sdf(path):
    """`scripts/v4Export.ts` 가 쓴 몸 SDF 격자 → (헤더, data float32[nz,ny,nx] 평탄)."""
    raw = Path(path).read_bytes()
    (hlen,) = struct.unpack_from("<I", raw, 0)
    head = json.loads(raw[4:4 + hlen].decode("utf-8"))
    n = head["nx"] * head["ny"] * head["nz"]
    data = np.frombuffer(raw, dtype="<f4", count=n, offset=4 + hlen)
    return head, data


@ti.data_oriented
class Collide:
    """몸 충돌만 도는 솔버. 담지 «않는» 것: 늘어남 · 굽힘 · 봉제 · 자기충돌."""

    def __init__(self, pos, vel, invm, sdf_head, sdf_data, thickness, mu, fp=ti.f32):
        np_fp = np.float64 if fp == ti.f64 else np.float32
        self.fp, self.np_fp = fp, np_fp
        self.n = int(pos.shape[0])
        g = sdf_head
        self.nx, self.ny, self.nz = int(g["nx"]), int(g["ny"]), int(g["nz"])
        self.ox, self.oy, self.oz = float(g["ox"]), float(g["oy"]), float(g["oz"])
        self.h, self.band = float(g["h"]), float(g["band"])
        self.thickness, self.mu = float(thickness), float(mu)
        self.pos = ti.Vector.field(3, fp, shape=self.n)
        self.prev = ti.Vector.field(3, fp, shape=self.n)
        self.vel = ti.Vector.field(3, fp, shape=self.n)
        self.invm = ti.field(fp, shape=self.n)
        self.grid = ti.field(ti.f32, shape=self.nx * self.ny * self.nz)   # v3 도 Float32Array 다
        self.hits = ti.field(ti.i32, shape=())        # 밀어낸 정점 수(진단)
        self.maxdepth = ti.field(ti.f64, shape=())
        self.pos.from_numpy(np.ascontiguousarray(pos, dtype=np_fp))
        self.vel.from_numpy(np.ascontiguousarray(vel, dtype=np_fp))
        self.invm.from_numpy(np.ascontiguousarray(invm, dtype=np_fp))
        self.grid.from_numpy(np.ascontiguousarray(sdf_data, dtype=np.float32))

    @ti.func
    def _at(self, a, b, c):
        return self.grid[(c * self.ny + b) * self.nx + a]      # bodySdf.ts:256 의 그 색인

    @ti.func
    def _sample(self, x, y, z):
        """`bodySdf.ts:246 sampleSdf` — 삼선형. 격자 밖이면 **band**(자유 공간)."""
        out = self.band
        fx = (x - self.ox) / self.h
        fy = (y - self.oy) / self.h
        fz = (z - self.oz) / self.h
        inside = not (fx < 0 or fy < 0 or fz < 0
                      or fx > self.nx - 1 or fy > self.ny - 1 or fz > self.nz - 1)
        if inside:
            i = ti.min(self.nx - 2, int(ti.floor(fx)))
            j = ti.min(self.ny - 2, int(ti.floor(fy)))
            k = ti.min(self.nz - 2, int(ti.floor(fz)))
            tx = fx - i
            ty = fy - j
            tz = fz - k
            c00 = self._at(i, j, k) * (1 - tx) + self._at(i + 1, j, k) * tx
            c10 = self._at(i, j + 1, k) * (1 - tx) + self._at(i + 1, j + 1, k) * tx
            c01 = self._at(i, j, k + 1) * (1 - tx) + self._at(i + 1, j, k + 1) * tx
            c11 = self._at(i, j + 1, k + 1) * (1 - tx) + self._at(i + 1, j + 1, k + 1) * tx
            out = (c00 * (1 - ty) + c10 * ty) * (1 - tz) + (c01 * (1 - ty) + c11 * ty) * tz
        return out

    @ti.func
    def _resolve(self, v):
        """`solver.ts:199 resolveCollisions` 의 정점 하나 몫 — 밀어내기 + 쿨롱 마찰."""
        p = self.pos[v]
        e = self.h
        d0 = self._sample(p[0], p[1], p[2])
        gx = self._sample(p[0] + e, p[1], p[2]) - self._sample(p[0] - e, p[1], p[2])
        gy = self._sample(p[0], p[1] + e, p[2]) - self._sample(p[0], p[1] - e, p[2])
        gz = self._sample(p[0], p[1], p[2] + e) - self._sample(p[0], p[1], p[2] - e)
        l = ti.sqrt(gx * gx + gy * gy + gz * gz)          # v3 는 hypot — 차 2.58e-16
        nrm = ti.Vector([0.0, 1.0, 0.0])
        if l >= EPS_N:
            nrm = ti.Vector([gx / l, gy / l, gz / l])
        d = d0 - self.thickness
        if d < 0.0:                                       # d ≥ 0 이면 «아무 일도 안 한다»(흡착 0)
            depth = -d
            self.hits[None] += 1
            ti.atomic_max(self.maxdepth[None], ti.cast(depth, ti.f64))
            self.pos[v] += depth * nrm
            if self.mu > 0.0:
                t = self.pos[v] - self.prev[v]
                t -= t.dot(nrm) * nrm
                tl = ti.sqrt(t.dot(t))
                if tl > EPS_T:
                    k = ti.min(1.0, (self.mu * depth) / tl)
                    self.pos[v] -= t * k

    @ti.kernel
    def run(self, frames: ti.i32, substeps: ti.i32, dt: float, gravity: float, damping: float):
        """`solver.ts:1050 step()` 에서 **제약을 뺀** 프레임 루프. 순회는 정점 순서대로 «직렬»."""
        ti.loop_config(serialize=True)
        for _ in range(1):
            h = dt / substeps
            decay = ti.exp(-damping * h)
            for _f in range(frames):
                for _sub in range(substeps):
                    for v in range(self.n):
                        self.prev[v] = self.pos[v]
                        if self.invm[v] != 0.0:
                            self.vel[v][1] -= gravity * h
                            self.pos[v] += self.vel[v] * h
                    for v in range(self.n):                # 몸 충돌 — 제약 «뒤», 속도 갱신 «앞»
                        if self.invm[v] != 0.0:
                            self._resolve(v)
                    for v in range(self.n):
                        if self.invm[v] != 0.0:
                            self.vel[v] = (self.pos[v] - self.prev[v]) / h * decay

    def step(self, frames, substeps, dt, gravity, damping):
        self.hits[None] = 0
        self.maxdepth[None] = 0.0
        self.run(frames, substeps, dt, gravity, damping)
        ti.sync()
        return (self.pos.to_numpy(), self.vel.to_numpy(),
                int(self.hits[None]), float(self.maxdepth[None]))
