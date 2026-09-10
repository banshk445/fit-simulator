"""v4-16 §1-② — **해소 커널의 색 분할 병렬화**. `selfcol.SelfCol` 을 **상속**한다(재작성 0).

v4-15 §1-③ 이 값으로 보인 것: 셀프 충돌이 한 서브스텝의 **78.95%** 이고 그중 **36.65%** 가
**해소 직렬 커널**(grid 1 × block 1)이다. 이 파일이 바꾸는 것은 **그 커널 하나**다.

```
 ① 그래프 — 접촉이 «정점»을 공유하면 이웃이다(접촉 하나는 정점 4개를 읽고 쓴다).
 ② 우선순위 = **v3 접촉 순서**(`crank` 오름차순 · v4-14 가 재현한 그 순서).
    ⟹ 결과는 **「v3 순서 «우선» 탐욕 컬러링」**이다 — 한 색 안의 접촉은 서로 정점을 공유하지 않고,
       색은 오름차순으로 «차례차례» 적용된다.
 ③ 색 «안»은 정점이 겹치지 않으므로 **동시 갱신 = 그 색 안의 순차 갱신과 «같다»**
    (각 접촉이 읽고 쓰는 자리가 자기 정점 4개뿐이고, 같은 색의 다른 접촉은 그 자리를 안 건드린다).
 ★ **색 «사이»에서는 순서가 접힌다** — v3 의 순차 결과와 «비트로» 같다고 주장하지 않는다(§0-5ㄷ).
   얼마나 갈리는지는 값으로 재고, 판정은 「같은 옷」(새 정의)로만 건다.
 ★ 라운드 수는 **고정**한다(호스트 동기화를 서브스텝마다 걸지 않으려고) — 남은 접촉 수는
   `left` 에 «누적»되고, 0 이 아니면 그 사실이 산출물에 그대로 뜬다(조용한 누락 0).
```
★ `from __future__ import annotations` 를 쓰지 않는다(v4-01 함정 2).
"""
import taichi as ti

from .selfcol import SelfCol

BIG = 1 << 30


@ti.data_oriented
class SelfColColored(SelfCol):
    def __init__(self, *a, **kw):
        self.rounds = int(kw.pop("rounds", 32))
        super().__init__(*a, **kw)
        self.color = ti.field(ti.i32, shape=self.max_cons)
        self.vown = ti.field(ti.i32, shape=self.n)
        self.left = ti.field(ti.i32, shape=())          # 색을 못 받은 접촉(누적 · 0 이어야 한다)
        self.ncolor = ti.field(ti.i32, shape=())        # 실제로 쓴 색 수(최대 색 번호 + 1)
        self.shared = ti.field(ti.i32, shape=())        # 같은 색 안 정점 공유(기계검증 · 0 이어야 한다)

    @ti.kernel
    def _color_init(self):
        for k in range(ti.min(self.ncon[None], self.max_cons)):
            self.color[k] = -1

    @ti.kernel
    def _round(self, c: ti.i32, m: ti.i32):
        """한 라운드 = **한 커널**(호스트 호출 1회). 최상위 `for` 넷이 «차례로» 돈다:
        ① 아직 색 없는 접촉의 정점만 소유 초기화 ② 청구(가장 이른 순위가 이긴다)
        ③ 승자에게 색 c ④ 그 색을 «병렬»로 해소.
        ★ Taichi 는 커널 안 최상위 루프를 «순서대로» 돌린다 ⟹ ①→②→③→④ 사이에 장벽이 선다.
        ★ 접촉 수 `m` 은 «인자»로 받는다 — 커널 안에서 스칼라 필드를 읽으면 라운드마다 직렬 태스크가 선다."""
        for k in range(m):                                         # ① 필요한 자리만 초기화
            if self.color[k] < 0:
                for q in ti.static(range(4)):
                    self.vown[self.cv[k][q]] = BIG
        for k in range(m):                                         # ②
            if self.color[k] < 0:
                for q in ti.static(range(4)):
                    ti.atomic_min(self.vown[self.cv[k][q]], self.crank[k])
        for k in range(m):                                         # ③
            if self.color[k] < 0:
                ok = 1
                for q in ti.static(range(4)):
                    if self.vown[self.cv[k][q]] != self.crank[k]:
                        ok = 0
                if ok == 1:
                    self.color[k] = c
                    ti.atomic_max(self.ncolor[None], c + 1)
        for k in range(m):                                         # ④ 색 c 를 병렬 해소
            if self.color[k] == c:
                nrm = self.cn[k]
                gap = 0.0
                den = 0.0
                for q in ti.static(range(4)):
                    v = self.cv[k][q]
                    cq = self.cc[k][q]
                    gap += cq * self.pos[v].dot(nrm)
                    den += self.invm[v] * cq * cq
                depth = self.sep - gap
                if depth > 0.0 and den >= 1e-20:
                    lam = depth / den
                    self.applied[None] += 1
                    for q in ti.static(range(4)):
                        v = self.cv[k][q]
                        w = self.invm[v]
                        if w != 0.0:
                            self.pos[v] += (lam * w * self.cc[k][q]) * nrm

    @ti.kernel
    def _tail_serial(self, m: ti.i32):
        """**꼬리 = 색을 못 받은 접촉을 v3 순서대로 «직렬» 해소**. 이것이 «정확»한 이유:
        승자 규칙(③)은 「이웃 중 내가 가장 이르다」이므로 **색을 받은 접촉의 «먼저» 이웃은 전부
        색을 받았다**. 그래서 (a 먼저 · b 나중 · 둘이 이웃)일 때 네 경우가 모두 순서를 지킨다 —
        둘 다 색 있음(색(a) < 색(b)) · a 만 색 있음(병렬이 꼬리보다 앞) · b 만 색 있음(**불가능**) ·
        둘 다 없음(꼬리에서 v3 순서). ⟹ **잘라도 v3 순차 결과와 같다.**"""
        ti.loop_config(serialize=True)
        for r in range(m):
            k = self.ord[r]
            if self.color[k] < 0:
                nrm = self.cn[k]
                gap = 0.0
                den = 0.0
                for q in ti.static(range(4)):
                    v = self.cv[k][q]
                    cq = self.cc[k][q]
                    gap += cq * self.pos[v].dot(nrm)
                    den += self.invm[v] * cq * cq
                depth = self.sep - gap
                if depth > 0.0 and den >= 1e-20:
                    lam = depth / den
                    self.applied[None] += 1
                    for q in ti.static(range(4)):
                        v = self.cv[k][q]
                        w = self.invm[v]
                        if w != 0.0:
                            self.pos[v] += (lam * w * self.cc[k][q]) * nrm

    @ti.kernel
    def _count_left(self):
        for k in range(ti.min(self.ncon[None], self.max_cons)):
            if self.color[k] < 0:
                self.left[None] += 1

    @ti.kernel
    def _check_shared(self):
        """기계검증 — 같은 색 안에서 정점을 공유하는 쌍이 있으면 센다(0 이어야 한다)."""
        m = ti.min(self.ncon[None], self.max_cons)
        for a in range(m):
            for b in range(m):
                if a < b and self.color[a] == self.color[b] and self.color[a] >= 0:
                    for p in ti.static(range(4)):
                        for q in ti.static(range(4)):
                            if self.cv[a][p] == self.cv[b][q]:
                                self.shared[None] += 1

    def _resolve(self):                                  # 부모의 직렬 해소를 «대신한다»
        m = min(int(self.ncon[None]), self.max_cons)
        self._color_init()
        for c in range(self.rounds):
            self._round(c, m)
        self._tail_serial(m)
        self._count_left()

    def color_stats(self):
        return dict(ncolor=int(self.ncolor[None]), left=int(self.left[None]),
                    shared=int(self.shared[None]))
