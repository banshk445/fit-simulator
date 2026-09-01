"""v4-14 §1-② — **후보 쌍 집합의 «격자 없는» 정본**을 만든다(대조의 기준선).

v3 의 후보 쌍은 「셀 공유 · 인접 아님 · 확장 AABB 겹침」인데, **확장 AABB 가 겹치면 그 겹침
구석의 셀을 반드시 함께 점유**한다(`solver.ts:518-524` 의 논증 · 그래서 「누락이 0」이다).
⟹ v3 의 집합 ⊆ **R = { (i,j) : i<j · 정점 비공유 · 확장 AABB 겹침 }** 이고, 격자는 «찾는 방법»일 뿐이다.

이 계기는 **R 을 전수(브루트포스)로** 만든다 — 격자 0 · 해시 0 · 삼각형 쌍 162,279,120 전량 검사.
그러면 세 값이 한 줄에 선다:
```
 |R| == v3 가 «스스로 센» 근접 쌍 수(selfStats[0])  ⟹ v3 집합 == R  (⊆ 에 크기가 같으므로)
 GPU 집합 == R                                      ⟹ GPU 집합 == v3 집합  (차집합 양방향 0)
```
★ 새 수 0 · 문턱 0 · 물리 0스텝. 진입: `py gpu/l3sc_ref.py`
"""
import json
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from oracle import load  # noqa: E402

CELL = "c100-h170-s45_M"
v3j = json.load(open(load.EXPORT / f"l3sc-v3-{CELL}.json", encoding="utf-8"))
pre = np.fromfile(load.EXPORT / f"l3sc-v3-{CELL}-pre.bin", dtype=np.float64).reshape(-1, 3)
tris = np.fromfile(load.EXPORT / f"l3sc-v3-{CELL}-tris.bin", dtype=np.int32).reshape(-1, 3)
TH = float(v3j["thickness"])
T = tris.shape[0]

P = pre[tris]                                   # (T,3,3)
lo = P.min(axis=1) - TH                         # solver.ts:541-544
hi = P.max(axis=1) + TH

t0 = time.perf_counter()
out = []
CH = 256
for s in range(0, T, CH):
    e = min(s + CH, T)
    a_lo, a_hi = lo[s:e, None, :], hi[s:e, None, :]
    ok = ((a_lo <= hi[None, :, :]) & (lo[None, :, :] <= a_hi)).all(axis=2)
    ii = np.arange(s, e)[:, None]
    ok &= ii < np.arange(T)[None, :]            # i < j
    # 인접 제외(solver.ts:595-601) — 정점을 하나라도 공유하면 «정상» 근접이다
    adj = np.zeros_like(ok)
    for p in range(3):
        for q in range(3):
            adj |= tris[s:e, p][:, None] == tris[None, :, q]
    ok &= ~adj
    i, j = np.nonzero(ok)
    if i.size:
        out.append(np.stack([i + s, j], axis=1).astype(np.int32))
ref = np.concatenate(out) if out else np.zeros((0, 2), np.int32)
ref = ref[np.lexsort((ref[:, 1], ref[:, 0]))]
el = time.perf_counter() - t0

meta = {"what": "v4-14 §1-② — 격자 없는 후보 쌍 정본 R", "cell": CELL, "T": T,
        "검사한_삼각형쌍": T * (T - 1) // 2, "R": int(ref.shape[0]),
        "v3_근접쌍": v3j["근접쌍"], "일치": int(ref.shape[0]) == int(v3j["근접쌍"]), "sec": el}
ref.tofile(str(load.EXPORT / f"l3sc-ref-{CELL}-pairs.bin"))
json.dump(meta, open(load.EXPORT / f"l3sc-ref-{CELL}.json", "w", encoding="utf-8"),
          indent=1, ensure_ascii=False)
print(json.dumps(meta, ensure_ascii=False, indent=1))
