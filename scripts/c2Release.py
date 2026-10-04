"""C2 §2④ — **제공 자산 발행**(측정 0 · 포장만).

하는 일 — ㄱ 굽기 산출(헤더 없는 f64 3n)을 **주입 blob 형식**으로 재포장한다
  (`[u32 헤더길이][JSON {n,frame,d,what}][pos f64 3n][vel f64 3n]` · 속도 블록은 0 · v4-49 형식 그대로) ·
ㄴ `sha` = **본문(헤더 뒤) sha256**(v4-50 이 바로잡은 그 규약) ·
ㄷ 몸 정점 파일을 복사한다(굽기에 쓴 그 파일 · 바이트 동일성 확인) ·
ㄹ `v1-provide.json`(편입 칸) · `index-merged-108.json`(판정·sha·어깨·옷깃) 을 쓴다.

진입: `OUT=public/v3diag/v5-c2 python3 scripts/c2Release.py`
"""
import hashlib, json, os, re, shutil, struct
from pathlib import Path

OUT = Path(os.environ.get("OUT", "public/v3diag/v5-c2"))
RES = Path("gpu/bake/results/c2-A108y")
JUDGE = Path("gpu/oracle/export/c2-judge")
G27 = Path("gpu/oracle/export/grid27")
AGG = json.load(open("gpu/oracle/export/c2-agg.json", encoding="utf-8"))
OUT.mkdir(parents=True, exist_ok=True)

judge = {p.stem: json.load(open(p, encoding="utf-8")) for p in JUDGE.glob("*.json")}
idx, provide, bodies = {}, [], set()
for cell, v in sorted(AGG["전량"].items()):
    tag = v["tag"]
    raw = RES / f"{tag}.bin"
    meta = RES / f"{tag}.json"
    j = judge.get(cell)
    ok = bool(v.get("pass")) and j is not None and j["어깨 걸림 통과(≥172)"] and j["G3(a) 통과(≤0)"]
    rec = {"status": "편입" if ok else "보류",
           "gate": "pass" if v.get("pass") else "fail",
           "f": v.get("정착프레임"), "sec": v.get("sec")}
    if j:
        rec["shoulderAbove"] = j["어깨 걸림(어깨선 위 정점)"]
        rec["collarG3aMm"] = j["G3(a) 링중심 − Y_NECK mm"]
    if ok and raw.exists() and meta.exists():
        m = json.load(open(meta, encoding="utf-8"))
        pos = raw.read_bytes()[: m["n"] * 24]
        assert len(pos) == m["n"] * 24, f"{cell}: 위치 바이트 부족"
        hdr = json.dumps({"n": m["n"], "frame": m.get("frames"), "d": 0.009,
                          "what": "C2 A포즈 정착 상태(asm1x · SH_DROP 38.1) · 재포장(위치 그대로 · 속도 0)"},
                         ensure_ascii=False).encode()
        body = pos + bytes(m["n"] * 24)
        (OUT / f"settled-{cell}.bin").write_bytes(struct.pack("<I", len(hdr)) + hdr + body)
        rec["sha"] = hashlib.sha256(body).hexdigest()
        provide.append(cell)
        bodies.add(cell.split("_")[0])
    idx[cell] = rec

for b in sorted(bodies):
    src = G27 / f"l3ap-body-{b}-a35.bin"
    dst = OUT / f"body-{b}.bin"
    shutil.copyfile(src, dst)
    # ★ C2 §2④ — **팔 축·원점도 함께 낸다**. 굽기가 쓴 그 인자여야 장면이 같다(v5-8 사고 5).
    shutil.copyfile(G27 / f"l3ap-body-{b}-a35.json", OUT / f"axis-{b}.json")
    shutil.copyfile(G27 / f"l3ap-origin-{b}-a35.json", OUT / f"origin-{b}.json")
    old = Path("public/v3diag/v4-a35") / f"body-{b}.bin"
    if old.exists():
        same = hashlib.sha256(old.read_bytes()).hexdigest() == hashlib.sha256(dst.read_bytes()).hexdigest()
        idx.setdefault("_몸", {})[b] = {"v4-a35 와 동일": same}

json.dump({"메타": {"what": "C2 편입 목록(게이트 pass ∧ 어깨 ≥ 172 ∧ G3(a) ≤ 0)",
                    "SH_DROP mm": 38.1, "job": "c2-A108y", "칸": len(provide)},
           "provide": provide}, open(OUT / "v1-provide.json", "w", encoding="utf-8"),
          ensure_ascii=False, indent=1)
json.dump(idx, open(OUT / "index-merged-108.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print(json.dumps({"편입": len(provide), "색인 칸": len([k for k in idx if not k.startswith('_')]),
                  "몸 파일": len(bodies), "자리": str(OUT)}, ensure_ascii=False))
