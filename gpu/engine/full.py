"""v4-06 §1-③ — **결합 솔버**(늘어남 + 굽힘 + 봉제 + 몸 충돌). 층2 가 쓰는 것.

v3 의 `solver.ts:1050 step()` 순서를 **그대로** 지킨다:

```
 서브스텝마다:
   ① 예측 — prev ← pos · vel.y −= g·h · pos += vel·h   (정점 순서)
   ② λ 초기화 — 제약 «전량»(:1077-1083)
   ③ 제약 투영 1회(:1084 iters = 1) — 순서는 `garmentScene.ts:734`
        **[...inplane, ...bends, ...seamCons]** ← 가우스–자이델이라 «순서가 곧 결과»다
   ④ 자기충돌 — **이 판에서 «없다»**(v4 이식 0 · 정의역 일치 · v3 쪽도 뺀다)
   ⑤ 몸 충돌(:1128) — 제약 «뒤» · 속도 갱신 «앞»
   ⑥ 속도 갱신 — vel = (pos − prev)/h · decay
```

★ **투영 산술은 검증된 세 모듈과 «같은 식»을 옮겨 적은 것**이다(`stretch.py` · `bending.py` ·
  `seam.py` · `collide.py`). 옮겨 적은 것이 어긋날 수 있으므로 **기계로 막는다** —
  `use_*` 플래그로 **한 갈래만 켜고 1스텝** 돌려 **각 단일 커널의 층1 정답과 대조**한다
  (`gpu/tests/test_full.py`). 사람이 눈으로 대조하지 않는다.
★ `from __future__ import annotations` 를 쓰지 않는다(v4-01 함정 2).
"""
import numpy as np
import taichi as ti

EPS_DENOM = 1e-20      # solver.ts:998  (굽힘 denomW)
EPS_DEGEN = 1e-14      # solver.ts:964  (굽힘 l1/l2/le)
EPS_LEN = 1e-12        # solver.ts:1151 (봉제 len)
EPS_N = 1e-20          # solver.ts:136  (충돌 법선 길이)
EPS_T = 1e-15          # solver.ts:238  (충돌 접선 변위)


@ti.data_oriented
class Full:
    def __init__(self, pos, vel, invm,
                 ip_idx, ip_par, k,
                 bd_idx, bd_par, ke,
                 sm_idx, sm_rest,
                 sdf_head, sdf_data, thickness, mu, fp=ti.f32):
        np_fp = np.float64 if fp == ti.f64 else np.float32
        self.fp, self.np_fp = fp, np_fp
        self.n = int(pos.shape[0])
        self.mi = int(ip_idx.shape[0])
        self.mb = int(bd_idx.shape[0])
        self.ms = int(sm_idx.shape[0])
        self.k, self.ke = float(k), float(ke)
        self.pos = ti.Vector.field(3, fp, shape=self.n)
        self.prev = ti.Vector.field(3, fp, shape=self.n)
        self.vel = ti.Vector.field(3, fp, shape=self.n)
        self.invm = ti.field(fp, shape=self.n)
        self.ip_idx = ti.Vector.field(3, ti.i32, shape=self.mi)
        self.ip_par = ti.Vector.field(5, fp, shape=self.mi)
        self.ip_lam = ti.Vector.field(3, fp, shape=self.mi)
        self.bd_idx = ti.Vector.field(4, ti.i32, shape=self.mb)
        self.bd_par = ti.Vector.field(2, fp, shape=self.mb)
        self.bd_lam = ti.field(fp, shape=self.mb)
        self.sm_idx = ti.Vector.field(2, ti.i32, shape=self.ms)
        self.sm_rest = ti.field(fp, shape=self.ms)
        self.sm_lam = ti.field(fp, shape=self.ms)
        g = sdf_head
        self.nx, self.ny, self.nz = int(g["nx"]), int(g["ny"]), int(g["nz"])
        self.ox, self.oy, self.oz = float(g["ox"]), float(g["oy"]), float(g["oz"])
        self.h, self.band = float(g["h"]), float(g["band"])
        self.thickness, self.mu = float(thickness), float(mu)
        self.grid = ti.field(ti.f32, shape=self.nx * self.ny * self.nz)
        self.degenerate = ti.field(ti.i32, shape=())
        for f, a, t in ((self.pos, pos, np_fp), (self.vel, vel, np_fp), (self.invm, invm, np_fp),
                        (self.ip_idx, ip_idx, np.int32), (self.ip_par, ip_par, np_fp),
                        (self.bd_idx, bd_idx, np.int32), (self.bd_par, bd_par, np_fp),
                        (self.sm_idx, sm_idx, np.int32), (self.sm_rest, sm_rest, np_fp),
                        (self.grid, sdf_data, np.float32)):
            f.from_numpy(np.ascontiguousarray(a, dtype=t))

    # ── 늘어남 — `stretch.py:_project` 와 같은 식(solver.ts:1229) ──
    @ti.func
    def _p_inplane(self, t, h2, kU, kV, kS):
        i0, i1, i2 = self.ip_idx[t][0], self.ip_idx[t][1], self.ip_idx[t][2]
        w0, w1, w2 = self.invm[i0], self.invm[i1], self.invm[i2]
        if w0 + w1 + w2 != 0.0:
            a, b, c, d, area = (self.ip_par[t][0], self.ip_par[t][1], self.ip_par[t][2],
                                self.ip_par[t][3], self.ip_par[t][4])
            for comp in ti.static(range(3)):
                e1 = self.pos[i1] - self.pos[i0]
                e2 = self.pos[i2] - self.pos[i0]
                xu = a * e1 + b * e2
                xv = c * e1 + d * e2
                C = 0.0
                stiff = 0.0
                g1 = ti.Vector([0.0, 0.0, 0.0])
                g2 = ti.Vector([0.0, 0.0, 0.0])
                if ti.static(comp == 0):
                    C = (xu.dot(xu) - 1.0) / 2.0
                    stiff = kU
                    g1 = a * xu
                    g2 = b * xu
                elif ti.static(comp == 1):
                    C = (xv.dot(xv) - 1.0) / 2.0
                    stiff = kV
                    g1 = c * xv
                    g2 = d * xv
                else:
                    C = xu.dot(xv) / 2.0
                    stiff = kS
                    g1 = (a * xv + c * xu) / 2.0
                    g2 = (b * xv + d * xu) / 2.0
                g0 = -(g1 + g2)
                denomW = w0 * g0.dot(g0) + w1 * g1.dot(g1) + w2 * g2.dot(g2)
                if denomW >= EPS_DENOM:
                    at = 1.0 / (area * stiff) / h2
                    dl = (-C - at * self.ip_lam[t][comp]) / (denomW + at)
                    self.ip_lam[t][comp] = self.ip_lam[t][comp] + dl
                    self.pos[i0] += w0 * dl * g0
                    self.pos[i1] += w1 * dl * g1
                    self.pos[i2] += w2 * dl * g2

    # ── 굽힘 — `bending.py:_project` 와 같은 식(solver.ts:986) ──
    @ti.func
    def _p_bend(self, t, h2, ke):
        p0, p1, p2, p3 = self.bd_idx[t][0], self.bd_idx[t][1], self.bd_idx[t][2], self.bd_idx[t][3]
        w0, w1, w2, w3 = self.invm[p0], self.invm[p1], self.invm[p2], self.invm[p3]
        if w0 + w1 + w2 + w3 != 0.0:
            e = self.pos[p1] - self.pos[p0]
            d2 = self.pos[p2] - self.pos[p0]
            d3 = self.pos[p3] - self.pos[p0]
            n1 = e.cross(d2)
            n2 = d3.cross(e)
            l1 = ti.sqrt(n1.dot(n1))
            l2 = ti.sqrt(n2.dot(n2))
            le2 = e.dot(e)
            le = ti.sqrt(le2)
            b0 = ti.Vector([0.0, 0.0, 0.0])
            b1 = ti.Vector([0.0, 0.0, 0.0])
            b2 = ti.Vector([0.0, 0.0, 0.0])
            b3 = ti.Vector([0.0, 0.0, 0.0])
            theta = 0.0
            if l1 < EPS_DEGEN or l2 < EPS_DEGEN or le < EPS_DEGEN:
                self.degenerate[None] += 1
            else:
                kA = -le / (l1 * l1)
                kB = -le / (l2 * l2)
                b2 = kA * n1
                b3 = kB * n2
                tA = d2.dot(e) / le2
                tB = d3.dot(e) / le2
                b0 = (tA - 1.0) * b2 + (tB - 1.0) * b3
                b1 = -tA * b2 - tB * b3
                a1 = n1 / l1
                a2 = n2 / l2
                cr = a1.cross(a2)
                theta = ti.atan2(cr.dot(e) / le, a1.dot(a2))
            denomW = (w0 * b0.dot(b0) + w1 * b1.dot(b1) + w2 * b2.dot(b2) + w3 * b3.dot(b3))
            if denomW >= EPS_DENOM:
                C = theta - self.bd_par[t][0]
                at = self.bd_par[t][1] / ke / h2
                dl = (-C - at * self.bd_lam[t]) / (denomW + at)
                self.bd_lam[t] = self.bd_lam[t] + dl
                self.pos[p0] += w0 * dl * b0
                self.pos[p1] += w1 * dl * b1
                self.pos[p2] += w2 * dl * b2
                self.pos[p3] += w3 * dl * b3

    # ── 봉제 — `seam.py:_project` 와 같은 식(solver.ts:1145) ──
    @ti.func
    def _p_seam(self, t, h2, k):
        i, j = self.sm_idx[t][0], self.sm_idx[t][1]
        dv = self.pos[j] - self.pos[i]
        ln = ti.sqrt(dv.dot(dv))
        if ln >= EPS_LEN:
            dh = dv / ln
            wi, wj = self.invm[i], self.invm[j]
            wsum = wi + wj
            if wsum != 0.0:
                C = ln - self.sm_rest[t]
                at = 1.0 / k / h2
                dl = (-C - at * self.sm_lam[t]) / (wsum + at)
                self.sm_lam[t] = self.sm_lam[t] + dl
                self.pos[i] -= wi * dl * dh
                self.pos[j] += wj * dl * dh

    # ── 몸 충돌 — `collide.py` 와 같은 식(bodySdf.ts:246 · solver.ts:126·199) ──
    @ti.func
    def _at(self, a, b, c):
        return self.grid[(c * self.ny + b) * self.nx + a]

    @ti.func
    def _sample(self, x, y, z):
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
    def _p_collide(self, v):
        p = self.pos[v]
        e = self.h
        d0 = self._sample(p[0], p[1], p[2])
        gx = self._sample(p[0] + e, p[1], p[2]) - self._sample(p[0] - e, p[1], p[2])
        gy = self._sample(p[0], p[1] + e, p[2]) - self._sample(p[0], p[1] - e, p[2])
        gz = self._sample(p[0], p[1], p[2] + e) - self._sample(p[0], p[1], p[2] - e)
        l = ti.sqrt(gx * gx + gy * gy + gz * gz)
        nrm = ti.Vector([0.0, 1.0, 0.0])
        if l >= EPS_N:
            nrm = ti.Vector([gx / l, gy / l, gz / l])
        d = d0 - self.thickness
        if d < 0.0:
            depth = -d
            self.pos[v] += depth * nrm
            if self.mu > 0.0:
                t = self.pos[v] - self.prev[v]
                t -= t.dot(nrm) * nrm
                tl = ti.sqrt(t.dot(t))
                if tl > EPS_T:
                    kk = ti.min(1.0, (self.mu * depth) / tl)
                    self.pos[v] -= t * kk

    @ti.kernel
    def run(self, frames: ti.i32, substeps: ti.i32, dt: float, gravity: float, damping: float,
            k: float, ke: float, use_ip: ti.i32, use_bd: ti.i32, use_sm: ti.i32, use_col: ti.i32):
        ti.loop_config(serialize=True)
        for _ in range(1):
            h = dt / substeps
            h2 = h * h
            decay = ti.exp(-damping * h)
            for _f in range(frames):
                for _sub in range(substeps):
                    for v in range(self.n):                       # ① 예측
                        self.prev[v] = self.pos[v]
                        if self.invm[v] != 0.0:
                            self.vel[v][1] -= gravity * h
                            self.pos[v] += self.vel[v] * h
                    for t in range(self.mi):                      # ② λ 초기화 — 제약 전량
                        self.ip_lam[t] = ti.Vector([0.0, 0.0, 0.0])
                    for t in range(self.mb):
                        self.bd_lam[t] = 0.0
                    for t in range(self.ms):
                        self.sm_lam[t] = 0.0
                    if use_ip != 0:                               # ③ 투영 — inplane → bend → seam
                        for t in range(self.mi):
                            self._p_inplane(t, h2, k, k, k)
                    if use_bd != 0:
                        for t in range(self.mb):
                            self._p_bend(t, h2, ke)
                    if use_sm != 0:
                        for t in range(self.ms):
                            self._p_seam(t, h2, k)
                    if use_col != 0:                              # ⑤ 몸 충돌(④ 자기충돌은 없다)
                        for v in range(self.n):
                            if self.invm[v] != 0.0:
                                self._p_collide(v)
                    for v in range(self.n):                       # ⑥ 속도 갱신
                        if self.invm[v] != 0.0:
                            self.vel[v] = (self.pos[v] - self.prev[v]) / h * decay

    def step(self, frames, substeps, dt, gravity, damping,
             use_ip=1, use_bd=1, use_sm=1, use_col=1):
        self.degenerate[None] = 0
        self.run(frames, substeps, dt, gravity, damping, self.k, self.ke,
                 int(use_ip), int(use_bd), int(use_sm), int(use_col))
        ti.sync()
        return self.pos.to_numpy(), self.vel.to_numpy(), int(self.degenerate[None])
