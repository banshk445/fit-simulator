"""v4-03 §1-③ — **굽힘 제약 이식**. v3 의 `bend`(힌지 이면각) 제약을 Taichi 로 옮긴다.

v3 코드 사실(손으로 적지 않고 «인용»한다):
  · `src/v3/solver.ts:73-88`   `BendConstraint` — 공유 엣지 p0·p1 · 날개 p2·p3 ·
                               `restAngle`(평면 제도 ⟹ **0**) · `ke`[N·m] · `shape = 4a/l²`
  · `src/v3/solver.ts:842`     `makeBend` — 엣지 맵에서 **날개가 «둘»인 엣지만** 힌지가 된다
                               (`wings.length !== 2` 는 경계 엣지 ⟹ 건너뛴다)
  · `src/v3/solver.ts:869`     `shape: (4 * a) / (l * l)` · `a` = 두 삼각형 «정지» 면적 합 ·
                               `l` = 정지 UV 에서 잰 공유 엣지 길이
  · `src/v3/garmentScene.ts:733` `makeBend(tris, uv, MAT.B)` ⟹ **ke = 원단 B**(gray 2.3191698e-5)
  · `src/v3/solver.ts:940`     `bendGradients` — n1 = e × d2 · n2 = d3 × e ·
                               ∇p2θ = −n1·|e|/|n1|² · `tA = (d2·e)/|e|²` 로 b0·b1 을 만든다
  · `src/v3/solver.ts:915`     `dihedral` — `atan2(sin, cos)` · sin = ((â1×â2)·e)/|e|
  · `src/v3/solver.ts:986`     `projectBend` — `at = c.shape / c.ke / h2` ⟹ **α = 4a/(ke·l²)**
  · `src/v3/solver.ts:1050`    `h = dt / substeps` · `:1084` 반복수 **1** · λ 는 서브스텝마다 0

★ **v3 와 «다를 수밖에 없는» 자리 2곳 — 값으로 등재한다(숨기지 않는다)**
  ① `Math.hypot` — v3 는 법선 길이 `l1`·`l2` 와 `dihedral` 의 `le` 에 `hypot` 을 쓴다.
     **Taichi 에는 `hypot` 이 없다** ⟹ 이 이식은 `sqrt(x²+y²+z²)` 를 쓴다.
     두 함수의 상대차는 **2.584e-16**(≈ 1.16 ULP_f64 · `scripts/v4Hinge.ts` 실측) —
     **f32 의 ULP(1.19e-07)보다 9 자릿수 작다** ⟹ f32 판정에는 관여하지 않는다.
     (v3 자신도 `bendGradients` 의 `le` 는 `sqrt(le2)`, `dihedral` 의 `le` 는 `hypot` 으로
      **서로 다른 함수**를 쓴다 — 이 이식은 그 «갈림»을 그대로 옮긴다.)
  ② 퇴화 분기 — v3 는 `l1<1e-14 || l2<1e-14 || le<1e-14` 이면 **0 을 돌려주는데 b0..b3 는
     «직전 제약의 값»이 남는다**(모듈 전역 버퍼). 이 이식은 그 자리에서 **기울기를 0 으로** 둔다
     ⟹ `denomW = 0` 이 되어 투영이 건너뛰어진다. **발화 횟수를 세어 0 임을 확인**한다
     (0 이면 두 구현은 «구별되지 않는다»). `degenerate` 필드가 그 계수기다.
★ `from __future__ import annotations` 를 쓰지 않는다(v4-01 함정 2).
"""
import numpy as np
import taichi as ti

EPS_DEGEN = 1e-14      # solver.ts:964 — l1/l2/le 퇴화 문턱(인용)
EPS_DENOM = 1e-20      # solver.ts:998 — denomW 문턱(인용)


def make_bend(tris, uv, ke, dtype=np.float32):
    """`solver.ts:842 makeBend` 의 이식 → (idx[mb,4] = p0,p1,p2,p3, par[mb,2] = restAngle, shape).

    엣지 맵의 순회 순서를 v3 와 «같게» 유지한다 — 삼각형 순서로 돌며 처음 본 엣지를 뒤에 붙인다
    (파이썬 dict 는 삽입 순서를 지키므로 `Map` 과 같은 순서가 나온다).
    """
    t = np.asarray(tris, dtype=np.int32).reshape(-1, 3)
    u = np.asarray(uv, dtype=np.float64).reshape(-1, 2)
    e1 = u[t[:, 1]] - u[t[:, 0]]
    e2 = u[t[:, 2]] - u[t[:, 0]]
    area = np.abs(e1[:, 0] * e2[:, 1] - e1[:, 1] * e2[:, 0]) / 2
    edges = {}
    for ti_, tri in enumerate(t):
        for i in range(3):
            a, b, w = int(tri[i]), int(tri[(i + 1) % 3]), int(tri[(i + 2) % 3])
            key = (a, b) if a < b else (b, a)
            e = edges.get(key)
            if e is None:
                e = {"a": min(a, b), "b": max(a, b), "wings": [], "areas": []}
                edges[key] = e
            e["wings"].append(w)
            e["areas"].append(float(area[ti_]))
    idx, par = [], []
    for e in edges.values():
        if len(e["wings"]) != 2:
            continue                                   # 경계 엣지 — 힌지 없음
        l = np.hypot(u[e["b"], 0] - u[e["a"], 0], u[e["b"], 1] - u[e["a"], 1])
        a = e["areas"][0] + e["areas"][1]
        idx.append([e["a"], e["b"], e["wings"][0], e["wings"][1]])
        par.append([0.0, (4 * a) / (l * l)])            # restAngle = 0(평면 제도)
    return np.asarray(idx, dtype=np.int32), np.asarray(par, dtype=dtype)


@ti.data_oriented
class Bending:
    """장면 하나를 Taichi 필드에 올리고 «굽힘만» 도는 솔버.

    담는 것: 예측(중력) · `bend` 투영 · 속도 갱신(감쇠).
    담지 «않는» 것: 늘어남 · 봉제 거리 · 자기충돌 · 몸 충돌 — 이 판의 표적이 아니다.
    """

    def __init__(self, pos, vel, invm, idx, par, ke, fp=ti.f32):
        np_fp = np.float64 if fp == ti.f64 else np.float32
        self.fp, self.np_fp = fp, np_fp
        self.n = int(pos.shape[0])
        self.mb = int(idx.shape[0])
        self.pos = ti.Vector.field(3, fp, shape=self.n)
        self.prev = ti.Vector.field(3, fp, shape=self.n)
        self.vel = ti.Vector.field(3, fp, shape=self.n)
        self.invm = ti.field(fp, shape=self.n)
        self.idx = ti.Vector.field(4, ti.i32, shape=self.mb)
        self.par = ti.Vector.field(2, fp, shape=self.mb)
        self.lam = ti.field(fp, shape=self.mb)
        self.degenerate = ti.field(ti.i32, shape=())     # 퇴화 분기 발화 계수기(★②)
        self.pos.from_numpy(np.ascontiguousarray(pos, dtype=np_fp))
        self.vel.from_numpy(np.ascontiguousarray(vel, dtype=np_fp))
        self.invm.from_numpy(np.ascontiguousarray(invm, dtype=np_fp))
        self.idx.from_numpy(np.ascontiguousarray(idx, dtype=np.int32))
        self.par.from_numpy(np.ascontiguousarray(par, dtype=np_fp))
        self.ke = float(ke)

    @ti.func
    def _project(self, t, h2, ke):
        """`solver.ts:986 projectBend` + `:940 bendGradients` + `:915 dihedral`."""
        p0, p1, p2, p3 = self.idx[t][0], self.idx[t][1], self.idx[t][2], self.idx[t][3]
        w0, w1, w2, w3 = self.invm[p0], self.invm[p1], self.invm[p2], self.invm[p3]
        if w0 + w1 + w2 + w3 != 0.0:
            e = self.pos[p1] - self.pos[p0]
            d2 = self.pos[p2] - self.pos[p0]
            d3 = self.pos[p3] - self.pos[p0]
            n1 = e.cross(d2)                              # solver.ts:955 — n1 = e × d2
            n2 = d3.cross(e)                              # solver.ts:958 — n2 = d3 × e
            l1 = ti.sqrt(n1.dot(n1))                      # v3 는 hypot — 차 2.58e-16(★①)
            l2 = ti.sqrt(n2.dot(n2))
            le2 = e.dot(e)
            le = ti.sqrt(le2)                             # solver.ts:963 — 여기는 v3 도 sqrt 다
            b0 = ti.Vector([0.0, 0.0, 0.0])
            b1 = ti.Vector([0.0, 0.0, 0.0])
            b2 = ti.Vector([0.0, 0.0, 0.0])
            b3 = ti.Vector([0.0, 0.0, 0.0])
            theta = 0.0
            if l1 < EPS_DEGEN or l2 < EPS_DEGEN or le < EPS_DEGEN:
                self.degenerate[None] += 1                # ★② 발화를 «센다»
            else:
                kA = -le / (l1 * l1)                      # ∇p2θ = −n1·|e|/|n1|²
                kB = -le / (l2 * l2)
                b2 = kA * n1
                b3 = kB * n2
                tA = d2.dot(e) / le2
                tB = d3.dot(e) / le2
                b0 = (tA - 1.0) * b2 + (tB - 1.0) * b3
                b1 = -tA * b2 - tB * b3
                a1 = n1 / l1                              # dihedral — 단위 법선
                a2 = n2 / l2
                cr = a1.cross(a2)
                theta = ti.atan2(cr.dot(e) / le, a1.dot(a2))
            denomW = (w0 * b0.dot(b0) + w1 * b1.dot(b1)
                      + w2 * b2.dot(b2) + w3 * b3.dot(b3))
            if denomW >= EPS_DENOM:
                C = theta - self.par[t][0]                # C = θ − restAngle
                at = self.par[t][1] / ke / h2             # α̃ = (4a/l²)/ke/h²
                dl = (-C - at * self.lam[t]) / (denomW + at)
                self.lam[t] = self.lam[t] + dl
                self.pos[p0] += w0 * dl * b0
                self.pos[p1] += w1 * dl * b1
                self.pos[p2] += w2 * dl * b2
                self.pos[p3] += w3 * dl * b3

    @ti.kernel
    def run(self, frames: ti.i32, substeps: ti.i32, dt: float,
            gravity: float, damping: float, ke: float):
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
                    for t in range(self.mb):
                        self.lam[t] = 0.0
                    for t in range(self.mb):
                        self._project(t, h2, ke)
                    for v in range(self.n):
                        if self.invm[v] != 0.0:
                            self.vel[v] = (self.pos[v] - self.prev[v]) / h * decay

    def step(self, frames, substeps, dt, gravity, damping):
        self.degenerate[None] = 0
        self.run(frames, substeps, dt, gravity, damping, self.ke)
        ti.sync()
        return self.pos.to_numpy(), self.vel.to_numpy(), int(self.degenerate[None])
