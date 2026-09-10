"""v4-16 §1-② — 전 정의역 결합 솔버의 **색 분할 해소판**. `full_sc.FullSC` 를 상속한다.

바뀐 것은 **세우는 셀프 충돌 클래스 하나**다(`SelfCol` → `SelfColColored`) —
`substep_a` · `substep_b` · 투영 산술 · 적용 자리는 **한 줄도 바뀌지 않는다**.
★ `full_sc.py` · `selfcol.py` 는 **바이트 불변**(§0-3) — 이 파일은 «새 파일»이다.
"""
import taichi as ti

from .full_sc import FullSC
from .selfcol_col import SelfColColored


@ti.data_oriented
class FullSCColored(FullSC):
    def __init__(self, *a, **kw):
        rounds = kw.pop("rounds", 32)
        super().__init__(*a, **kw)
        self.sc = SelfColColored(self.pos, self.invm, self.sc.tri.to_numpy(), self.thickness,
                                 fp=self.fp, rounds=rounds)
