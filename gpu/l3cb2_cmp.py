"""v4-13 — 두 위치 덤프(float64 3n)의 좌표차. 계산 0(읽기만) · 물리 0프레임.

진입: `py gpu/l3cb2_cmp.py <A.bin> <B.bin> [tag] [--hdrA] [--hdrB]`
      — 최대·중앙·p99 정점거리(mm) + 최대 성분 절대차(mm)
      · `--hdrA/--hdrB` = 그 파일이 v3 blob 형식(uint32 헤더길이 + JSON 헤더 + pos + vel)이면 헤더를
        건너뛰고 «앞의 3n 개»(= 위치)만 읽는다. 헤더 길이는 파일에서 «읽는다»(손 상수 0).
"""
import json
import sys
from pathlib import Path

import numpy as np

ARGV = [x for x in sys.argv[1:] if not x.startswith("--")]
FLAGS = {x for x in sys.argv[1:] if x.startswith("--")}
A, B = Path(ARGV[0]), Path(ARGV[1])
TAG = ARGV[2] if len(ARGV) > 2 else f"{A.stem}__{B.stem}"


def rd(path: Path, hdr: bool) -> np.ndarray:
    """헤더 있는 v3 blob 이면 위치 3n 만 뜬다 — 헤더 길이는 파일에서 읽는다."""
    raw = path.read_bytes()
    if not hdr:
        return np.frombuffer(raw, dtype=np.float64).reshape(-1, 3)
    hl = int(np.frombuffer(raw[:4], dtype=np.uint32)[0])
    body = raw[4 + hl:]
    assert len(body) % 48 == 0, f"pos+vel 이 아니다 — {len(body)}"
    return np.frombuffer(body[: len(body) // 2], dtype=np.float64).reshape(-1, 3)


a = rd(A, "--hdrA" in FLAGS)
b = rd(B, "--hdrB" in FLAGS)
assert a.shape == b.shape, f"모양이 다르다 {a.shape} {b.shape}"
d = np.linalg.norm(a - b, axis=1) * 1000.0
comp = np.abs(a - b).max() * 1000.0
out = {"A": str(A), "B": str(B), "n": int(a.shape[0]),
       "bytesIdentical": bool(a.tobytes() == b.tobytes()),
       "maxVertexMm": float(d.max()), "medVertexMm": float(np.median(d)),
       "p99VertexMm": float(np.percentile(d, 99)), "maxCoordMm": float(comp),
       "maxAt": int(np.argmax(d)),
       "meanShiftMm": [float(x) for x in (b - a).mean(axis=0) * 1000.0]}
json.dump(out, open(f"gpu/oracle/export/l3cb2-cmp-{TAG}.json", "w", encoding="utf-8"),
          indent=1, ensure_ascii=False)
print(json.dumps(out, indent=1, ensure_ascii=False))
