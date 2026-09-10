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


# ─── v4-02 §1-② — **덤프 리더**(v3 조립 산출물). `scripts/v4Export.ts` · `scripts/v4Strip.ts` 가 쓴다 ───
EXPORT = Path(__file__).resolve().parent / "export"


def _blob(path):
    """[u32 헤더길이][헤더 JSON][페이로드] — v3 blob 과 «같은» 포장 규칙."""
    raw = Path(path).read_bytes()
    (hlen,) = struct.unpack_from("<I", raw, 0)
    return json.loads(raw[4 : 4 + hlen].decode("utf-8")), raw[4 + hlen :]


def cells_table() -> list:
    """39칸 요약표(칸 · 정점 · 삼각형 · 제약 수 · 원단) — `v4Export.ts` 산출."""
    return json.loads((EXPORT / "cells.json").read_text(encoding="utf-8"))


def scene(cell_id: str):
    """한 칸의 **늘어남 장면** → (헤더, invMass f64[n], idx i32[m,3], par f64[m,5])."""
    head, pay = _blob(EXPORT / f"scene-{cell_id}.bin")
    n, m = int(head["n"]), int(head["m"])
    o = 0
    invm = np.frombuffer(pay, dtype="<f8", count=n, offset=o); o += n * 8
    idx = np.frombuffer(pay, dtype="<i4", count=m * 3, offset=o).reshape(m, 3); o += m * 3 * 4
    par = np.frombuffer(pay, dtype="<f8", count=m * 5, offset=o).reshape(m, 5)
    return head, invm, idx, par


def strip_v3():
    """합성 「한 줄 천」의 v3 정답 → (헤더, uv, tris, invMass, pos, vel) — 전부 f64."""
    head, pay = _blob(EXPORT / "strip-v3.bin")
    n, nt = int(head["n"]), int(head["tris"])
    o = 0
    uv = np.frombuffer(pay, dtype="<f8", count=n * 2, offset=o).reshape(n, 2); o += n * 2 * 8
    tris = np.frombuffer(pay, dtype="<i4", count=nt * 3, offset=o).reshape(nt, 3); o += nt * 3 * 4
    invm = np.frombuffer(pay, dtype="<f8", count=n, offset=o); o += n * 8
    pos = np.frombuffer(pay, dtype="<f8", count=n * 3, offset=o).reshape(n, 3); o += n * 3 * 8
    vel = np.frombuffer(pay, dtype="<f8", count=n * 3, offset=o).reshape(n, 3)
    return head, uv, tris, invm, pos, vel


def cell_step(cell_id: str):
    """「늘어남만 1스텝」의 v3 정답 → (헤더, 투영 «전» pos f64[n,3], 투영 «후» pos f64[n,3])."""
    head, pay = _blob(EXPORT / f"cellstep-{cell_id}.bin")
    n = int(head["n"])
    before = np.frombuffer(pay, dtype="<f8", count=n * 3, offset=0).reshape(n, 3)
    after = np.frombuffer(pay, dtype="<f8", count=n * 3, offset=n * 3 * 8).reshape(n, 3)
    return head, before, after


# ─── v4-03 §1-③ — 굽힘 덤프 리더 ──────────────────────────────────────────────
def scene_bend(cell_id: str):
    """한 칸의 **굽힘 장면** → (헤더, idx i32[mb,4] = p0,p1,p2,p3, par f64[mb,2] = restAngle, shape)."""
    head, pay = _blob(EXPORT / f"scene-bend-{cell_id}.bin")
    mb = int(head["mb"])
    idx = np.frombuffer(pay, dtype="<i4", count=mb * 4, offset=0).reshape(mb, 4)
    par = np.frombuffer(pay, dtype="<f8", count=mb * 2, offset=mb * 4 * 4).reshape(mb, 2)
    return head, idx, par


def cell_step_bend(cell_id: str):
    """「굽힘만 1스텝」의 v3 정답 → (헤더, 투영 «전» pos, 투영 «후» pos) — 전부 f64."""
    head, pay = _blob(EXPORT / f"cellstep-bend-{cell_id}.bin")
    n = int(head["n"])
    before = np.frombuffer(pay, dtype="<f8", count=n * 3, offset=0).reshape(n, 3)
    after = np.frombuffer(pay, dtype="<f8", count=n * 3, offset=n * 3 * 8).reshape(n, 3)
    return head, before, after


def hinge_v3():
    """합성 「두 삼각형 힌지」의 v3 정답 → (헤더, uv, tris, bidx, invMass, pos, vel)."""
    head, pay = _blob(EXPORT / "hinge-v3.bin")
    n, nt, mb = int(head["n"]), int(head["tris"]), int(head["mb"])
    o = 0
    uv = np.frombuffer(pay, dtype="<f8", count=n * 2, offset=o).reshape(n, 2); o += n * 2 * 8
    tris = np.frombuffer(pay, dtype="<i4", count=nt * 3, offset=o).reshape(nt, 3); o += nt * 3 * 4
    bidx = np.frombuffer(pay, dtype="<i4", count=mb * 4, offset=o).reshape(mb, 4); o += mb * 4 * 4
    invm = np.frombuffer(pay, dtype="<f8", count=n, offset=o); o += n * 8
    pos = np.frombuffer(pay, dtype="<f8", count=n * 3, offset=o).reshape(n, 3); o += n * 3 * 8
    vel = np.frombuffer(pay, dtype="<f8", count=n * 3, offset=o).reshape(n, 3)
    return head, uv, tris, bidx, invm, pos, vel


def converge_v3(sys_name: str):
    """층2 — 합성계를 «수렴까지» 돌린 v3 정답 → (헤더, uv, tris, invMass, pos, vel)."""
    head, pay = _blob(EXPORT / f"converge-{sys_name}-v3.bin")
    n, nt = int(head["n"]), int(head["tris"])
    o = 0
    uv = np.frombuffer(pay, dtype="<f8", count=n * 2, offset=o).reshape(n, 2); o += n * 2 * 8
    tris = np.frombuffer(pay, dtype="<i4", count=nt * 3, offset=o).reshape(nt, 3); o += nt * 3 * 4
    invm = np.frombuffer(pay, dtype="<f8", count=n, offset=o); o += n * 8
    pos = np.frombuffer(pay, dtype="<f8", count=n * 3, offset=o).reshape(n, 3); o += n * 3 * 8
    vel = np.frombuffer(pay, dtype="<f8", count=n * 3, offset=o).reshape(n, 3)
    return head, uv, tris, invm, pos, vel


def cell_step_kind(cell_id: str, kind: str):
    """「<kind> 만 1스텝」의 v3 정답 → (헤더, 전 pos, 후 pos). kind = inplane|bend|dist|collision."""
    suffix = "" if kind == "inplane" else f"-{kind}"
    head, pay = _blob(EXPORT / f"cellstep{suffix}-{cell_id}.bin")
    n = int(head["n"])
    before = np.frombuffer(pay, dtype="<f8", count=n * 3, offset=0).reshape(n, 3)
    after = np.frombuffer(pay, dtype="<f8", count=n * 3, offset=n * 3 * 8).reshape(n, 3)
    return head, before, after
