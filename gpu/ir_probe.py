"""v4-11 §1-② — **제품 커널(`engine/full.py:run`)의 컴파일 IR 확인**(§0-4ㄴ㉠㉡의 기계 증거).

`Full` 을 «정본 데이터»로 세우고 `frames=0` 으로 부른다 ⟹ **커널은 컴파일되지만 계산은 0** 이다.
`ti.init(print_ir=True)` 가 뱉는 CHI IR 에서 `range_for` 의 **직렬/병렬 표기**를 그대로 딴다.

★ 물리 0스텝 · `engine/` diff 0 · 산출 파일 0(표준출력만).
진입: `py gpu/ir_probe.py`
"""
import sys
from pathlib import Path

import numpy as np
import taichi as ti

sys.path.insert(0, str(Path(__file__).resolve().parent))
from oracle import load  # noqa: E402
from engine import full as F, collide as CO, seam as SE  # noqa: E402

CELL, BODY = "c100-h170-s45_M", "c100-h170-s45"
hs, invm, ip_idx, ip_par = load.scene(CELL)
hb, bd_idx, bd_par = load.scene_bend(CELL)
hm, sm_idx, sm_rest = SE.load_seam(load.EXPORT / f"scene-seam-{CELL}.bin")
sh, sdata = CO.load_sdf(load.EXPORT / f"sdf-{BODY}.bin")
n = hs["n"]
head, st, _ = load.cloth(CELL)
pos0 = st[: n * 3].reshape(n, 3)
vel0 = st[n * 3:].reshape(n, 3)

ti.init(arch=ti.cuda, default_fp=ti.f32, print_ir=True)
assert ti.lang.impl.current_cfg().arch == ti.cuda, "조용한 arch 폴백(v4-01 함정 1)"
fu = F.Full(pos0.astype(np.float32), vel0.astype(np.float32), invm.astype(np.float32),
            ip_idx, ip_par.astype(np.float32), hs["k"], bd_idx, bd_par.astype(np.float32),
            hb["ke"], sm_idx, sm_rest.astype(np.float32), sh, sdata,
            sh["THICK"], sh["MU"], fp=ti.f32)
print("=== [v4-11] full.Full.run 컴파일 시작(frames=0 · 계산 0) ===", flush=True)
fu.step(0, hs["substeps"], 1 / 60, 9.81, 6.0)
print("=== [v4-11] full.Full.run 컴파일 끝 ===", flush=True)
