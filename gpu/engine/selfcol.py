"""v4-14 §1-① — **셀프 충돌**(마지막 커널). `src/v3/solver.ts` 의 셀프 충돌을 «옮긴다».

인용 자리(§0-5ㄱ · 손 상수 0 · 이 파일의 수는 전부 아래에서 온다):
```
 solver.ts:509-573  광역 — cell = mean(엣지 길이) + sep(:547) · 삼각형 AABB ±thickness ·
                    lo/hi = clamp(floor(box/cell)) · SC_CLAMP 2047(:287)
 solver.ts:574-624  협역 — 중복 제거 = «최소 모서리 셀»(:580) · 인접 제외 = 정점 공유(:595) ·
                    확장 AABB 겹침 · 근접 쌍 계수(:610) · 특징 15개 = 정점–삼각형 6 + 엣지–엣지 9
 solver.ts:304-341  scEmit — d² ≥ sep² 버림 · d ≤ 1e-12 버림 · [정점4 · 계수4 · 법선3 · 깊이1]
 solver.ts:359-411  closestPtTri(Ericson §5.1.5)   solver.ts:417-458 closestSegSeg(§5.1.9)
 solver.ts:641-670  해소 — Gauss–Seidel(간극 재측정) · depth ≤ 0 건너뜀 · denom < 1e-20 건너뜀 ·
                    λ = depth / Σ w·coef² · pos += λ·w·coef·n
 solver.ts:1117-1122 적용 순서 = 제약 투영 «뒤» · 몸 충돌 «앞» (이 파일은 순서를 정하지 않는다)
```

**자료구조는 다르고 «결과 집합»은 같아야 한다**(회차 프롬프트 ①). 그 근거는 코드에 있다 —
v3 의 후보 쌍은 「셀을 공유하고 · 인접 아니고 · 확장 AABB 가 겹치는 쌍」인데, **확장 AABB 가
겹치면 그 겹침 구석의 셀을 반드시 함께 점유**하므로 (`solver.ts:518-524` 주석의 논증)
후보 쌍 집합 = **{ (i,j) : i<j · 정점 비공유 · 확장 AABB 겹침 }** 이고 **격자와 무관**하다.
격자는 «찾는 방법»일 뿐이다. 이 파일은 그래서 조밀 격자(고정 용량)로 찾는다.

★ **순서는 «격자에 의존»한다**(Gauss–Seidel · §0-5ㄹ). v3 의 접촉 순서 =
  (셀 «생성» 순서 = (최소 점유 삼각형 t, 그 t 의 상자 안 순회 인덱스), 셀 안 삼각형 오름차순 쌍,
  특징 15개 고정 순서). 이 파일은 그 순위를 **셀마다 원자 최소값으로 세어** 재현한다.
★ `from __future__ import annotations` 를 쓰지 않는다(v4-01 함정 2).
"""
import numpy as np
import taichi as ti

SC_CLAMP = 2047                       # solver.ts:287
EPS_D = 1e-12                         # solver.ts:322  (d ≤ 1e-12 이면 방향이 없다 ⟹ 버린다)
EPS_DEN = 1e-20                       # solver.ts:656  denom
EPS_SEG = 1e-20                       # solver.ts:431  a·e 퇴화 판정


@ti.data_oriented
class SelfCol:
    """v3 셀프 충돌의 Taichi 판. `pos`·`invm` 은 «밖»에서 받는다(솔버가 주인)."""

    def __init__(self, pos, invm, tris, thickness, fp=ti.f64,
                 cell_cap=64, max_cells=1 << 22, max_pairs=1 << 20, max_cons=1 << 18):
        self.fp = fp
        self.pos = pos
        self.invm = invm
        self.n = int(invm.shape[0])
        tri = np.ascontiguousarray(np.asarray(tris, np.int32).reshape(-1, 3))
        self.T = int(tri.shape[0])
        self.thickness = float(thickness)
        self.sep = 2.0 * float(thickness)
        self.cell_cap = int(cell_cap)
        self.max_cells = int(max_cells)
        self.max_pairs = int(max_pairs)
        self.max_cons = int(max_cons)

        self.tri = ti.Vector.field(3, ti.i32, shape=self.T)
        self.tri.from_numpy(tri)
        self.blo = ti.Vector.field(3, fp, shape=self.T)      # 확장 AABB 최소
        self.bhi = ti.Vector.field(3, fp, shape=self.T)
        self.clo = ti.Vector.field(3, ti.i32, shape=self.T)  # 셀 범위
        self.chi = ti.Vector.field(3, ti.i32, shape=self.T)

        self.sum_len = ti.field(fp, shape=())
        self.cell = ti.field(fp, shape=())
        self.gmin = ti.Vector.field(3, ti.i32, shape=())
        self.gmax = ti.Vector.field(3, ti.i32, shape=())
        self.dim = ti.Vector.field(3, ti.i32, shape=())
        self.ncell = ti.field(ti.i32, shape=())

        self.cnt = ti.field(ti.i32, shape=self.max_cells)        # 셀당 삼각형 수
        self.minT = ti.field(ti.i32, shape=self.max_cells)       # 셀 «생성» 순위의 첫 항
        self.slot = ti.field(ti.i32, shape=self.max_cells * self.cell_cap)
        self.over = ti.field(ti.i32, shape=())                   # 용량 초과(0 이어야 한다)

        self.npair = ti.field(ti.i32, shape=())
        self.pair = ti.Vector.field(2, ti.i32, shape=self.max_pairs)
        self.pcell = ti.field(ti.i32, shape=self.max_pairs)       # 그 쌍을 «맡은» 셀

        self.ncon = ti.field(ti.i32, shape=())
        self.cv = ti.Vector.field(4, ti.i32, shape=self.max_cons)   # 정점 4
        self.cc = ti.Vector.field(4, fp, shape=self.max_cons)       # 계수 4
        self.cn = ti.Vector.field(3, fp, shape=self.max_cons)       # 법선
        self.cd = ti.field(fp, shape=self.max_cons)                 # 방출 시 침투 깊이
        self.ckey = ti.field(ti.i64, shape=self.max_cons)           # v3 순서 키
        self.crank = ti.field(ti.i32, shape=self.max_cons)          # 순위(0..ncon-1)
        self.ord = ti.field(ti.i32, shape=self.max_cons)            # 순위 → 접촉 인덱스
        self.applied = ti.field(ti.i32, shape=())                   # 해소 횟수(selfStats[1])
        self.maxpen = ti.field(fp, shape=())                        # 최대 침투(selfStats[2])

    # ── 광역 ────────────────────────────────────────────────────────────────
    @ti.kernel
    def _boxes(self):
        self.sum_len[None] = 0.0
        for t in range(self.T):
            a, b, c = self.tri[t][0], self.tri[t][1], self.tri[t][2]
            pa, pb, pc = self.pos[a], self.pos[b], self.pos[c]
            self.sum_len[None] += (pb - pa).norm() + (pc - pb).norm() + (pa - pc).norm()
            lo = ti.min(ti.min(pa, pb), pc)
            hi = ti.max(ti.max(pa, pb), pc)
            for k in ti.static(range(3)):
                self.blo[t][k] = lo[k] - self.thickness
                self.bhi[t][k] = hi[k] + self.thickness

    @ti.kernel
    def _cells(self):
        inv = 1.0 / self.cell[None]
        for k in ti.static(range(3)):
            self.gmin[None][k] = SC_CLAMP
            self.gmax[None][k] = -SC_CLAMP
        for t in range(self.T):
            for k in ti.static(range(3)):
                lo = ti.cast(ti.floor(self.blo[t][k] * inv), ti.i32)
                hi = ti.cast(ti.floor(self.bhi[t][k] * inv), ti.i32)
                lo = ti.min(ti.max(lo, -SC_CLAMP), SC_CLAMP)
                hi = ti.min(ti.max(hi, -SC_CLAMP), SC_CLAMP)
                self.clo[t][k] = lo
                self.chi[t][k] = hi
                ti.atomic_min(self.gmin[None][k], lo)
                ti.atomic_max(self.gmax[None][k], hi)

    @ti.func
    def _cid(self, cx, cy, cz):
        d = self.dim[None]
        g = self.gmin[None]
        return (cx - g[0]) * d[1] * d[2] + (cy - g[1]) * d[2] + (cz - g[2])

    @ti.kernel
    def _fill(self):
        for i in range(self.ncell[None]):
            self.cnt[i] = 0
            self.minT[i] = self.T
        for t in range(self.T):
            for cx in range(self.clo[t][0], self.chi[t][0] + 1):
                for cy in range(self.clo[t][1], self.chi[t][1] + 1):
                    for cz in range(self.clo[t][2], self.chi[t][2] + 1):
                        c = self._cid(cx, cy, cz)
                        ti.atomic_min(self.minT[c], t)
                        s = ti.atomic_add(self.cnt[c], 1)
                        if s < self.cell_cap:
                            self.slot[c * self.cell_cap + s] = t
                        else:
                            self.over[None] += 1

    # ── 후보 쌍 — 「셀 공유 · 인접 아님 · 확장 AABB 겹침」 ───────────────────────
    @ti.func
    def _adj(self, i, j):
        r = 0
        for p in ti.static(range(3)):
            for q in ti.static(range(3)):
                if self.tri[i][p] == self.tri[j][q]:
                    r = 1
        return r

    @ti.func
    def _boxhit(self, i, j):
        r = 1
        for k in ti.static(range(3)):
            if self.blo[i][k] > self.bhi[j][k] or self.blo[j][k] > self.bhi[i][k]:
                r = 0
        return r

    @ti.kernel
    def _pairs(self):
        for c in range(self.ncell[None]):
            m = ti.min(self.cnt[c], self.cell_cap)
            for ii in range(m):
                for jj in range(ii + 1, m):
                    i, j = self.slot[c * self.cell_cap + ii], self.slot[c * self.cell_cap + jj]
                    if i > j:
                        i, j = j, i
                    # 중복 제거(solver.ts:580) — 두 셀 «범위»의 최소 모서리에서만 한 번
                    own = 1
                    cc3 = self._cxyz(c)
                    for k in ti.static(range(3)):
                        if cc3[k] != ti.max(self.clo[i][k], self.clo[j][k]):
                            own = 0
                    if own == 1 and self._adj(i, j) == 0 and self._boxhit(i, j) == 1:
                        p = ti.atomic_add(self.npair[None], 1)
                        if p < self.max_pairs:
                            self.pair[p] = ti.Vector([i, j])
                            self.pcell[p] = c

    @ti.func
    def _cxyz(self, c):
        """셀 «선형» 인덱스 → 셀 좌표(격자 주소 역산 · `_cid` 의 역)."""
        d = self.dim[None]
        g = self.gmin[None]
        return ti.Vector([c // (d[1] * d[2]) + g[0],
                          (c // d[2]) % d[1] + g[1],
                          c % d[2] + g[2]])

    # ── 협역 — Ericson 두 최근접 루틴(solver.ts:359-458 그대로) ──────────────────
    @ti.func
    def _closest_pt_tri(self, oa, ob, oc, p):
        """점 p 에서 삼각형 (a,b,c) 의 최근접점과 무게중심. solver.ts:359-411."""
        a, b, c = self.pos[oa], self.pos[ob], self.pos[oc]
        ab = b - a
        ac = c - a
        bary = ti.Vector([0.0, 0.0, 0.0], dt=self.fp)
        pt = ti.Vector([0.0, 0.0, 0.0], dt=self.fp)
        done = 0
        d1 = ab.dot(p - a)
        d2 = ac.dot(p - a)
        if d1 <= 0.0 and d2 <= 0.0:
            bary = ti.Vector([1.0, 0.0, 0.0], dt=self.fp); pt = a; done = 1
        d3 = ab.dot(p - b)
        d4 = ac.dot(p - b)
        if done == 0 and d3 >= 0.0 and d4 <= d3:
            bary = ti.Vector([0.0, 1.0, 0.0], dt=self.fp); pt = b; done = 1
        vc = d1 * d4 - d3 * d2
        if done == 0 and vc <= 0.0 and d1 >= 0.0 and d3 <= 0.0:
            v = d1 / (d1 - d3)
            bary = ti.Vector([1.0 - v, v, 0.0], dt=self.fp); pt = a + v * ab; done = 1
        d5 = ab.dot(p - c)
        d6 = ac.dot(p - c)
        if done == 0 and d6 >= 0.0 and d5 <= d6:
            bary = ti.Vector([0.0, 0.0, 1.0], dt=self.fp); pt = c; done = 1
        vb = d5 * d2 - d1 * d6
        if done == 0 and vb <= 0.0 and d2 >= 0.0 and d6 <= 0.0:
            w = d2 / (d2 - d6)
            bary = ti.Vector([1.0 - w, 0.0, w], dt=self.fp); pt = a + w * ac; done = 1
        va = d3 * d6 - d5 * d4
        if done == 0 and va <= 0.0 and (d4 - d3) >= 0.0 and (d5 - d6) >= 0.0:
            w = (d4 - d3) / ((d4 - d3) + (d5 - d6))
            bary = ti.Vector([0.0, 1.0 - w, w], dt=self.fp); pt = b + w * (c - b); done = 1
        if done == 0:
            den = 1.0 / (va + vb + vc)
            v = vb * den
            w = vc * den
            bary = ti.Vector([1.0 - v - w, v, w], dt=self.fp)
            pt = a + ab * v + ac * w
        return bary, pt

    @ti.func
    def _closest_seg_seg(self, o1, o2, o3, o4):
        """두 선분의 최근접 매개변수 (s, t). solver.ts:417-458."""
        d1 = self.pos[o2] - self.pos[o1]
        d2 = self.pos[o4] - self.pos[o3]
        r = self.pos[o1] - self.pos[o3]
        a = d1.dot(d1)
        e = d2.dot(d2)
        f = d2.dot(r)
        sv = 0.0
        tv = 0.0
        if a <= EPS_SEG and e <= EPS_SEG:
            sv = 0.0; tv = 0.0
        elif a <= EPS_SEG:
            sv = 0.0; tv = ti.min(ti.max(f / e, 0.0), 1.0)
        else:
            cc = d1.dot(r)
            if e <= EPS_SEG:
                tv = 0.0; sv = ti.min(ti.max(-cc / a, 0.0), 1.0)
            else:
                b = d1.dot(d2)
                den = a * e - b * b
                if den != 0.0:
                    sv = ti.min(ti.max((b * f - cc * e) / den, 0.0), 1.0)
                else:
                    sv = 0.0
                tv = (b * sv + f) / e
                if tv < 0.0:
                    tv = 0.0; sv = ti.min(ti.max(-cc / a, 0.0), 1.0)
                elif tv > 1.0:
                    tv = 1.0; sv = ti.min(ti.max((b - cc) / a, 0.0), 1.0)
        return sv, tv

    @ti.func
    def _emit(self, d2, i0, i1, i2, i3, c0, c1, c2, c3, dvec, key):
        """solver.ts:304-341 — sep 안이고 방향이 있는 특징만 접촉으로 낸다."""
        if d2 < self.sep * self.sep:
            d = ti.sqrt(d2)
            if d > EPS_D:
                k = ti.atomic_add(self.ncon[None], 1)
                if k < self.max_cons:
                    self.cv[k] = ti.Vector([i0, i1, i2, i3])
                    self.cc[k] = ti.Vector([c0, c1, c2, c3], dt=self.fp)
                    self.cn[k] = dvec / d
                    self.cd[k] = self.sep - d
                    self.ckey[k] = key
                    ti.atomic_max(self.maxpen[None], self.sep - d)

    @ti.kernel
    def _narrow(self):
        for p in range(ti.min(self.npair[None], self.max_pairs)):
            i, j = self.pair[p][0], self.pair[p][1]
            c = self.pcell[p]
            mt = self.minT[c]
            # 셀 «생성» 순위 — (최소 점유 삼각형, 그 삼각형 상자 안 순회 인덱스)
            ny = self.chi[mt][1] - self.clo[mt][1] + 1
            nz = self.chi[mt][2] - self.clo[mt][2] + 1
            cc3 = self._cxyz(c)
            li = ((cc3[0] - self.clo[mt][0]) * ny
                  + (cc3[1] - self.clo[mt][1])) * nz + (cc3[2] - self.clo[mt][2])
            base = ((((ti.cast(mt, ti.i64) << 10) | ti.cast(li, ti.i64)) << 15)
                    | ti.cast(i, ti.i64))
            base = (base << 15) | ti.cast(j, ti.i64)
            base = base << 4
            a0, a1, a2 = self.tri[i][0], self.tri[i][1], self.tri[i][2]
            b0, b1, b2 = self.tri[j][0], self.tri[j][1], self.tri[j][2]
            av = ti.Vector([a0, a1, a2])
            bv = ti.Vector([b0, b1, b2])
            # 정점–삼각형 6개(solver.ts:612-617 순서 그대로)
            for q in ti.static(range(3)):
                bary, pt = self._closest_pt_tri(bv[0], bv[1], bv[2], self.pos[av[q]])
                dv = self.pos[av[q]] - pt
                self._emit(dv.dot(dv), av[q], bv[0], bv[1], bv[2],
                           1.0, -bary[0], -bary[1], -bary[2], dv, base | q)
            for q in ti.static(range(3)):
                bary, pt = self._closest_pt_tri(av[0], av[1], av[2], self.pos[bv[q]])
                dv = self.pos[bv[q]] - pt
                self._emit(dv.dot(dv), bv[q], av[0], av[1], av[2],
                           1.0, -bary[0], -bary[1], -bary[2], dv, base | (3 + q))
            # 엣지–엣지 9개(solver.ts:618-622 — scEA/scEB 짝 순서 그대로)
            for pp in ti.static(range(3)):
                for qq in ti.static(range(3)):
                    p1, p2 = av[pp], av[(pp + 1) % 3]
                    q1, q2 = bv[qq], bv[(qq + 1) % 3]
                    sv, tv = self._closest_seg_seg(p1, p2, q1, q2)
                    dv = (self.pos[p1] + sv * (self.pos[p2] - self.pos[p1])
                          - (self.pos[q1] + tv * (self.pos[q2] - self.pos[q1])))
                    self._emit(dv.dot(dv), p1, p2, q1, q2,
                               1.0 - sv, sv, -(1.0 - tv), -tv, dv, base | (6 + pp * 3 + qq))

    # ── 순서 — v3 의 접촉 순서를 «순위»로 재현한다(§0-5ㄹ) ─────────────────────
    @ti.kernel
    def _rank(self):
        m = ti.min(self.ncon[None], self.max_cons)
        for k in range(m):
            r = 0
            for q in range(m):
                if self.ckey[q] < self.ckey[k]:
                    r += 1
            self.crank[k] = r
        for k in range(m):
            self.ord[self.crank[k]] = k

    @ti.kernel
    def _rank_natural(self):
        """대조용 — 병렬 «자연» 순서(방출 순서 그대로 · 판정 아님 · §0-5ㄹ ★)."""
        for k in range(ti.min(self.ncon[None], self.max_cons)):
            self.ord[k] = k

    # ── 해소 — Gauss–Seidel(solver.ts:641-670) ─────────────────────────────────
    @ti.kernel
    def _resolve(self):
        ti.loop_config(serialize=True)
        for r in range(ti.min(self.ncon[None], self.max_cons)):
            k = self.ord[r]
            nrm = self.cn[k]
            gap = 0.0
            den = 0.0
            for q in ti.static(range(4)):
                v = self.cv[k][q]
                cq = self.cc[k][q]
                gap += cq * self.pos[v].dot(nrm)
                den += self.invm[v] * cq * cq
            depth = self.sep - gap
            if depth > 0.0 and den >= EPS_DEN:
                lam = depth / den
                self.applied[None] += 1
                for q in ti.static(range(4)):
                    v = self.cv[k][q]
                    w = self.invm[v]
                    if w != 0.0:
                        self.pos[v] += (lam * w * self.cc[k][q]) * nrm

    # ── 한 번 적용 ──────────────────────────────────────────────────────────
    def apply(self, order="v3"):
        self._boxes()
        self.cell[None] = self.sum_len[None] / (3.0 * self.T) + self.sep
        self._cells()
        g, G = self.gmin[None], self.gmax[None]
        dim = [int(G[k] - g[k] + 1) for k in range(3)]
        nc = dim[0] * dim[1] * dim[2]
        if nc > self.max_cells:
            raise RuntimeError(f"격자 셀 {nc} > 용량 {self.max_cells} — 상자가 너무 넓다")
        self.dim[None] = ti.Vector(dim)
        self.ncell[None] = nc
        self.over[None] = 0
        self.npair[None] = 0
        self.ncon[None] = 0
        self.applied[None] = 0
        self.maxpen[None] = 0.0
        self._fill()
        if self.over[None] != 0:
            raise RuntimeError(f"셀 용량 {self.cell_cap} 초과 {self.over[None]}회 — cell_cap 을 키워야 한다")
        self._pairs()
        if self.npair[None] > self.max_pairs:
            raise RuntimeError(f"쌍 {self.npair[None]} > 용량 {self.max_pairs}")
        self._narrow()
        if self.ncon[None] > self.max_cons:
            raise RuntimeError(f"접촉 {self.ncon[None]} > 용량 {self.max_cons}")
        if order == "v3":
            self._rank()
        else:
            self._rank_natural()
        self._resolve()
        return dict(cell=float(self.cell[None]), ncell=nc, dim=dim,
                    pairs=int(self.npair[None]), cons=int(self.ncon[None]),
                    applied=int(self.applied[None]), maxpen=float(self.maxpen[None]))
