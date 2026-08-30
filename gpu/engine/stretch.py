"""v4-02 §1-③ — **늘어남(신장) 제약 이식**. v3 의 `inplane` 제약을 Taichi f32 로 옮긴다.

v3 코드 사실(손으로 적지 않고 «인용»한다):
  · `src/v3/solver.ts:1`      파일 머리 — 「XPBD 솔버 뼈대 + 중력 + **신장**(선형 이방 · 갈래 ⓑ)」
  · `src/v3/solver.ts:37-71`  `InplaneConstraint` — 그린 변형 G 성분을 그대로 C 로 쓴다
  · `src/v3/solver.ts:806`    `makeInplane` — D = Du⁻¹ 를 접어 둔다(a,b,c,d) · `area = |det|/2`
  · `src/v3/garmentScene.ts:734` `makeInplane(tris, uv, KMEM, KMEM, KMEM)` ⟹ **kU = kV = kS = 원단 k**
  · `src/v3/solver.ts:1229`   `projectInplane` — 성분 3개(G00·G11·G01)를 **차례로** 투영
  · `src/v3/solver.ts:1301`   `at = 1 / (c.area * stiff) / h2`  ⟹ α = 1/(A·k) · α̃ = α/h²
  · `src/v3/solver.ts:1050`   `const h = p.dt / p.substeps;`
  · `src/v3/solver.ts:1077-1083` λ 는 **서브스텝마다 0**, 반복 사이에는 누적(XPBD 유도)
  · `src/v3/solver.ts:1084`   `const iters = p.iterations ?? 1;` ⟹ **반복수 = 1**(small-steps)
  · `src/v3/solver.ts:1053`   `const decay = Math.exp(-p.damping * h);`
  · `src/v3/garmentScene.ts:798` `substepsForCloth(DT, KMEM, MAT.rho, q.eMin, 0.95)` ⟹ **서브스텝은 «도출»**

★ **순서가 곧 결과다.** v3 는 제약을 배열 순서대로 **가우스–자이델**로 푼다(`for (const c of cs)`).
  병렬 야코비로 바꾸면 값이 «반올림 규모»가 아니라 «다른 물리»가 된다 ⟹ 이 판의 이식은
  **직렬 순회를 그대로 지킨다**(`ti.loop_config(serialize=True)`). 병렬화는 「같은 옷」 기준이
  선 «뒤»에 별도 판으로 다룬다.
★ `from __future__ import annotations` 를 쓰지 않는다(v4-01 함정 2).
"""
import numpy as np
import taichi as ti


def make_inplane(tris, uv, dtype=np.float32):
    """`solver.ts:806 makeInplane` 의 이식. (idx[m,3], par[m,5] = a,b,c,d,area)."""
    t = np.asarray(tris, dtype=np.int32).reshape(-1, 3)
    u = np.asarray(uv, dtype=dtype).reshape(-1, 2)
    i0, i1, i2 = t[:, 0], t[:, 1], t[:, 2]
    m00 = u[i1, 0] - u[i0, 0]
    m10 = u[i1, 1] - u[i0, 1]
    m01 = u[i2, 0] - u[i0, 0]
    m11 = u[i2, 1] - u[i0, 1]
    det = m00 * m11 - m01 * m10
    if np.any(np.abs(det) < 1e-14):
        raise ValueError("degenerate rest triangle")          # solver.ts:822 와 같은 조건
    par = np.stack([m11 / det, -m10 / det, -m01 / det, m00 / det, np.abs(det) / 2], axis=1)
    return t.astype(np.int32), par.astype(dtype)


def assign_mass(n, tris, uv, rho, pinned=(), dtype=np.float32):
    """`solver.ts:assignMassFromMesh` 의 이식 — 삼각형 면적의 1/3 씩 세 꼭짓점에 나눈다."""
    t = np.asarray(tris, dtype=np.int32).reshape(-1, 3)
    u = np.asarray(uv, dtype=dtype).reshape(-1, 2)
    e1 = u[t[:, 1]] - u[t[:, 0]]
    e2 = u[t[:, 2]] - u[t[:, 0]]
    area = np.abs(e1[:, 0] * e2[:, 1] - e1[:, 1] * e2[:, 0]) / 2
    share = (area * dtype(rho)) / 3
    m = np.zeros(n, dtype=dtype)
    for c in range(3):
        np.add.at(m, t[:, c], share)
    inv = np.zeros(n, dtype=dtype)
    ok = m > 0
    inv[ok] = 1 / m[ok]
    for p in pinned:
        inv[p] = 0
    return inv, float(m.sum())


@ti.data_oriented
class Stretch:
    """장면 하나를 Taichi 필드에 올리고 «늘어남만» 도는 솔버.

    담는 것: 예측(중력) · `inplane` 투영 · 속도 갱신(감쇠).
    담지 «않는» 것: 굽힘 · 봉제 거리 · 자기충돌 · 몸 충돌 — 이 판의 표적이 아니다.
    """

    def __init__(self, pos, vel, invm, idx, par, k, fp=ti.f32):
        """`fp` 는 **진단용 갈래**다 — v4 정본 정밀도는 float32(`CLAUDE.md` v4 절).
        f64 로 한 번 돌리면 「이식이 틀렸는가 / f32 가 좁은가」를 «값으로» 가를 수 있다."""
        np_fp = np.float64 if fp == ti.f64 else np.float32
        self.fp, self.np_fp = fp, np_fp
        self.n = int(pos.shape[0])
        self.m = int(idx.shape[0])
        self.pos = ti.Vector.field(3, fp, shape=self.n)
        self.prev = ti.Vector.field(3, fp, shape=self.n)
        self.vel = ti.Vector.field(3, fp, shape=self.n)
        self.invm = ti.field(fp, shape=self.n)
        self.idx = ti.Vector.field(3, ti.i32, shape=self.m)
        self.par = ti.Vector.field(5, fp, shape=self.m)
        self.lam = ti.Vector.field(3, fp, shape=self.m)
        self.pos.from_numpy(np.ascontiguousarray(pos, dtype=np_fp))
        self.vel.from_numpy(np.ascontiguousarray(vel, dtype=np_fp))
        self.invm.from_numpy(np.ascontiguousarray(invm, dtype=np_fp))
        self.idx.from_numpy(np.ascontiguousarray(idx, dtype=np.int32))
        self.par.from_numpy(np.ascontiguousarray(par, dtype=np_fp))
        self.k = float(k)

    @ti.func
    def _project(self, t, h2, kU, kV, kS):
        """`solver.ts:1229 projectInplane` — 성분 3개를 «차례로». 매 성분에서 e1·e2 를 다시 뜬다."""
        i0, i1, i2 = self.idx[t][0], self.idx[t][1], self.idx[t][2]
        w0, w1, w2 = self.invm[i0], self.invm[i1], self.invm[i2]
        if w0 + w1 + w2 != 0.0:
            a, b, c, d, area = self.par[t][0], self.par[t][1], self.par[t][2], self.par[t][3], self.par[t][4]
            for comp in ti.static(range(3)):
                e1 = self.pos[i1] - self.pos[i0]
                e2 = self.pos[i2] - self.pos[i0]
                xu = a * e1 + b * e2
                xv = c * e1 + d * e2
                C = 0.0
                stiff = 0.0
                g1 = ti.Vector([0.0, 0.0, 0.0])
                g2 = ti.Vector([0.0, 0.0, 0.0])
                if ti.static(comp == 0):                       # C = G00 = (xu·xu − 1)/2
                    C = (xu.dot(xu) - 1.0) / 2.0
                    stiff = kU
                    g1 = a * xu
                    g2 = b * xu
                elif ti.static(comp == 1):                     # C = G11 = (xv·xv − 1)/2
                    C = (xv.dot(xv) - 1.0) / 2.0
                    stiff = kV
                    g1 = c * xv
                    g2 = d * xv
                else:                                          # C = G01 = (xu·xv)/2
                    C = xu.dot(xv) / 2.0
                    stiff = kS
                    g1 = (a * xv + c * xu) / 2.0
                    g2 = (b * xv + d * xu) / 2.0
                g0 = -(g1 + g2)
                denomW = w0 * g0.dot(g0) + w1 * g1.dot(g1) + w2 * g2.dot(g2)
                if denomW >= 1e-20:
                    at = 1.0 / (area * stiff) / h2             # α̃ = α/h² · α = 1/(A·k)
                    dl = (-C - at * self.lam[t][comp]) / (denomW + at)
                    self.lam[t][comp] = self.lam[t][comp] + dl
                    self.pos[i0] += w0 * dl * g0
                    self.pos[i1] += w1 * dl * g1
                    self.pos[i2] += w2 * dl * g2

    @ti.kernel
    def run(self, frames: ti.i32, substeps: ti.i32, dt: float,
            gravity: float, damping: float, kU: float, kV: float, kS: float):
        """`solver.ts:1050 step()` 의 프레임 루프. **전부 직렬** — 가우스–자이델 순서를 지킨다."""
        ti.loop_config(serialize=True)
        for _ in range(1):
            h = dt / substeps
            h2 = h * h
            decay = ti.exp(-damping * h)
            for _f in range(frames):
                for _sub in range(substeps):
                    for v in range(self.n):                    # 예측 — prev 는 «전 정점» 에 쓴다
                        self.prev[v] = self.pos[v]
                        if self.invm[v] != 0.0:
                            self.vel[v][1] -= gravity * h
                            self.pos[v] += self.vel[v] * h
                    for t in range(self.m):                    # λ 는 서브스텝마다 0
                        self.lam[t] = ti.Vector([0.0, 0.0, 0.0])
                    for t in range(self.m):                    # iterations = 1
                        self._project(t, h2, kU, kV, kS)
                    for v in range(self.n):                    # 속도 갱신
                        if self.invm[v] != 0.0:
                            self.vel[v] = (self.pos[v] - self.prev[v]) / h * decay

    def step(self, frames, substeps, dt, gravity, damping):
        self.run(frames, substeps, dt, gravity, damping, self.k, self.k, self.k)
        ti.sync()
        return self.pos.to_numpy(), self.vel.to_numpy()


def ulp_bound(max_abs_coord, steps):
    """상한 = steps × 4·ULP_f32(최대|좌표|) — 4 ULP 규칙은 v3-87 등재(손 상수 0)."""
    import math
    if max_abs_coord == 0:
        return 0.0
    return steps * 4.0 * (2.0 ** (math.floor(math.log2(abs(max_abs_coord))) - 23))
