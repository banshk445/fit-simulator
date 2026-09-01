"""v4-15 §1-① — **표본 8칸을 «기계가» 고른다**(손 고르기 0 · §0-5ㄱ 규칙 그대로).

후보 = 정답지 39칸(`public/v3diag/v3-77/settled-*.bin` 디렉터리에서 뜬다) · **칸 id 사전순** ·
슬롯 8개를 ① 가슴 최소 ② 가슴 최대 ③ 키 최소 ④ 키 최대 ⑤ 어깨 최소 ⑥ 어깨 최대
⑦ 사이즈 S ⑧ 사이즈 XL 순으로 채우고, 각 슬롯은 **아직 뽑히지 않은 첫 칸**을 고른다.
축의 최소·최대는 **39칸에 실재하는 값**에서 뜬다(새 수 0).

★ **두 집합을 «둘 다» 낸다**(§1-①ㄱ 이 그 이유를 값으로 적는다):
  A = 규칙을 **39칸 위에** 그대로 적용한 8칸
  B = 규칙을 **«대조 가능» 37칸 위에** 적용한 8칸 — v4-02 §1 이 이미 등재한 「보류 2칸」
      (정답지 blob 의 정점 수가 **지금 조립과 다르다** = 옛 조립분)을 뺀 것. 그 2칸은 blob 을
      현재 장면에 **실을 수조차 없다**(`n` 이 다르다) ⟹ 실행 «불가»이지 실패가 아니다.
  **집행은 B 로 한다**(§1-①ㄱ · 값 보기 «전» 결정 · 문턱·순서·구현은 고치지 않는다).

산출 = `gpu/oracle/export/l3br-pick.json` · 진입: `py gpu/l3br_pick.py`
"""
import json
import re
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from oracle import load  # noqa: E402

SRC = Path("public/v3diag/v3-77")
ids = sorted(p.name[len("settled-"):-len(".bin")] for p in SRC.glob("settled-*.bin"))


def parse(i):
    m = re.match(r"c([\d.]+)-h([\d.]+)-s([\d.]+)_(\w+)$", i)
    return dict(id=i, chest=float(m.group(1)), height=float(m.group(2)),
                shoulder=float(m.group(3)), size=m.group(4))


C = [parse(i) for i in ids]
# 「대조 가능」 = blob 헤더의 n 이 지금 조립의 n 과 같은 칸(v4-02 §1 등재 · 손 목록 0)
import struct as _st
cj = json.load(open(load.EXPORT / "cells.json", encoding="utf-8"))
asm = {c["id"]: int(c["n"]) for c in cj}
def blob_n(i):
    b = (SRC / f"settled-{i}.bin").read_bytes()[:4096]
    hl = _st.unpack("<I", b[:4])[0]
    return int(json.loads(b[4:4 + hl].decode("utf-8"))["n"])
HOLD = [c["id"] for c in C if asm.get(c["id"]) != blob_n(c["id"])]
ch = sorted({c["chest"] for c in C})
hh = sorted({c["height"] for c in C})
sh = sorted({c["shoulder"] for c in C})
slots = [("가슴 최소", lambda c: c["chest"] == ch[0]), ("가슴 최대", lambda c: c["chest"] == ch[-1]),
         ("키 최소", lambda c: c["height"] == hh[0]), ("키 최대", lambda c: c["height"] == hh[-1]),
         ("어깨 최소", lambda c: c["shoulder"] == sh[0]), ("어깨 최대", lambda c: c["shoulder"] == sh[-1]),
         ("사이즈 S", lambda c: c["size"] == "S"), ("사이즈 XL", lambda c: c["size"] == "XL")]
def run(pool):
    pk, rw = [], []
    for nm, f in slots:
        for c in pool:
            if f(c) and c["id"] not in pk:
                pk.append(c["id"])
                rw.append((nm, c))
                break
    return pk, rw


A_pick, _ = run(C)
POOL = [c for c in C if c["id"] not in HOLD]
pick, rows = [], []
for nm, f in slots:
    for c in POOL:
        if f(c) and c["id"] not in pick:
            pick.append(c["id"])
            b = (SRC / f"settled-{c['id']}.bin").read_bytes()[:4096]
            hl = struct.unpack("<I", b[:4])[0]
            hd = json.loads(b[4:4 + hl].decode("utf-8"))
            rows.append(dict(슬롯=nm, cell=c["id"], body=c["id"].rsplit("_", 1)[0], size=c["size"],
                             chest=c["chest"], height=c["height"], shoulder=c["shoulder"],
                             blobFrame=hd["frame"], n=hd["n"]))
            break
out = {"what": "v4-15 §1-① 표본 8칸(규칙 §0-5ㄱ · 손 고르기 0)", "후보수": len(C),
       "축": {"가슴": ch, "키": hh, "어깨": sh},
       "보류칸(옛 조립 · v4-02 등재)": [{"cell": i, "blob_n": blob_n(i), "조립_n": asm[i]} for i in HOLD],
       "A(39칸 위 규칙)": A_pick, "B(대조 가능 37칸 위 규칙 · 집행 대상)": None,
       "A와 B의 차": None,
       "기본몸M_포함": "c100-h170-s45_M" in pick,
       "바디": sorted({r["body"] for r in rows}), "표본": rows}
out["B(대조 가능 37칸 위 규칙 · 집행 대상)"] = pick
out["A와 B의 차"] = {"A에만": [x for x in A_pick if x not in pick], "B에만": [x for x in pick if x not in A_pick]}
json.dump(out, open(load.EXPORT / "l3br-pick.json", "w", encoding="utf-8"), indent=1, ensure_ascii=False)
for r in rows:
    print(f"{r['슬롯']:8s} {r['cell']:24s} body {r['body']:18s} blobFrame {r['blobFrame']:4d} n {r['n']}")
print(f"바디 {len(out['바디'])}종 · 기본몸 M 포함 {out['기본몸M_포함']}")
print(f"보류칸(옛 조립) {HOLD} · A와 B의 차 {out['A와 B의 차']}")
