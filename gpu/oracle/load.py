"""v4-01 §1-② — **v3 정답지 로더**. v3 산출물을 **읽기만** 한다(쓰기 0 · 물리 0).

v3 는 동결됐고(v3-92 §0-2) 이 모듈은 그 자산을 numpy 로 여는 «창»이다.
포맷은 v3 코드에서 온 사실이다:
  · 몸 blob  `body-<bodyId>.bin`   = float32 정점 (x,y,z) 나열
  · 옷 blob  `settled-<cellId>.bin`= [uint32 헤더길이][헤더 JSON][float64 상태 페이로드]
    (`dressRun.stateBlob` · 상태 sha 는 **헤더를 뺀 페이로드**의 sha256 — v3-49 등재)
  · 분류     `index-merged-108.v3-91.json`(v3-91 §1-④ㄷ 채택 정본)
"""
from __future__ import annotations
import hashlib
import json
import struct
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
V3 = ROOT / "public" / "v3diag" / "v3-77"
INDEX = V3 / "index-merged-108.v3-91.json"
PROVIDE = V3 / "v1-provide-35.v3-91.json"


def index() -> dict:
    """분류 정본 108칸."""
    return json.loads(INDEX.read_text(encoding="utf-8"))


def provide() -> list[str]:
    """제공 목록. 파일이 «메타 + provide» 객체이면 배열만 꺼낸다(v3-81 형식)."""
    j = json.loads(PROVIDE.read_text(encoding="utf-8"))
    return j if isinstance(j, list) else j["provide"]


def body(body_id: str) -> np.ndarray:
    """몸 정점 (n, 3) float32."""
    raw = (V3 / f"body-{body_id}.bin").read_bytes()
    return np.frombuffer(raw, dtype="<f4").reshape(-1, 3)


def body_sha(body_id: str) -> str:
    return hashlib.sha256((V3 / f"body-{body_id}.bin").read_bytes()).hexdigest()


def cloth(cell_id: str) -> tuple[dict, np.ndarray, str]:
    """옷 상태 blob → (헤더, 상태 float64 배열, **상태 sha256**).

    sha 는 **헤더를 뺀 페이로드**에서 뜬다 — 헤더의 `frame` 은 재발행으로 바뀌므로
    정본 셀에 쓸 수 없다(v3-49 · `V3Product.tsx` 대조 규칙과 «같은 정의»).
    """
    raw = (V3 / f"settled-{cell_id}.bin").read_bytes()
    (hlen,) = struct.unpack_from("<I", raw, 0)
    head = json.loads(raw[4 : 4 + hlen].decode("utf-8"))
    payload = raw[4 + hlen :]
    return head, np.frombuffer(payload, dtype="<f8"), hashlib.sha256(payload).hexdigest()


def cloth_positions(cell_id: str) -> np.ndarray:
    """옷 정점 (n, 3) — 상태 페이로드의 **앞 3n 개**가 위치다(`stateBlob` 순서)."""
    head, state, _ = cloth(cell_id)
    n = int(head["n"])
    return state[: n * 3].reshape(n, 3)
