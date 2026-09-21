"""v5-27 §1-③ — **108칸 집계**(측정만 · 물리 0줄 · 판정 식은 게이트 산출을 «읽어» 센다).

하는 일
  ① `results/<job>/gate-*.json` 을 모아 pass/fail 과 **채널별 fail 부류**를 센다
  ② `*.throw.json`(조립 던짐)을 모아 자리·부류를 적는다
  ③ `<칸>.json`(굽기 meta)에서 정착 프레임·s/프레임·`vs 정본 중앙`을 모은다
  ④ `fit-*.json`(층3)에서 5행 성립·`pressN` 을 센다
  ⑤ **v4-46 대비** — 그 판의 `gate-*.json` 을 같은 자리에서 읽어
     (ㄱ) 그때 판정 (ㄴ) **지금 채널로 재판정**(목선 내림 v5-25 + 자기관통 허용 v5-27) (ㄷ) 이 판(asm1x)
     셋을 나란히 놓는다 ⟹ 「채널이 옮긴 몫」과 「조립이 옮긴 몫」이 갈린다.

진입: `NEW=gpu/bake/results/v5-27-A108x OLD=<v4-46 gate 폴더> OUT=gpu/oracle/export/v5-27-agg.json \
       python3 scripts/v5Agg27.py`
"""
import json
import os
import re
from collections import Counter
from pathlib import Path

NEW = Path(os.environ.get("NEW", "gpu/bake/results/v5-27-A108x"))
OLD = Path(os.environ.get("OLD", "")) if os.environ.get("OLD") else None
OUT = Path(os.environ.get("OUT", "gpu/oracle/export/v5-27-agg.json"))
PEN_MAX, ALLOW_MM, SETTLE_MM = 0.5, 1.9, 0.1      # s4Gate.ts 의 등재 문턱(인용 · 새 수 0)


def cell_of(tag: str) -> str:
    """태그 `<몸>x_<사이즈>` → 칸 이름 `<몸>_<사이즈>`(꼬리 `x` 를 뗀다)."""
    return re.sub(r"x_([A-Z]+)$", r"_\1", tag)


def rejudge(ch: dict, settle_mm: float) -> list:
    """게이트 산출의 채널 값을 **지금 자**로 다시 센다(목선 내림 · 자기관통 허용)."""
    f = []
    if not ch["③a 관통 최대 mm"] <= PEN_MAX:
        f.append("③a 관통")
    if ch["자기관통 교차"] != 0 and ch["최소 쌍거리 mm"] < ALLOW_MM:
        f.append("자기관통")
    if ch.get("보조 장치(invMass=0)", 0) != 0:
        f.append("pinned")
    if settle_mm is not None and not settle_mm <= SETTLE_MM:
        f.append("정착")
    return f


rows, throws = {}, {}
for g in sorted(NEW.glob("gate-*.json")):
    tag = g.name[5:-5]
    G = json.load(open(g, encoding="utf-8"))
    cell = cell_of(tag)
    r = {"tag": tag, "pass": G["pass"], "fails": G["fails"], "채널": G["채널"],
         "창순변위 mm": (G.get("정착") or {}).get("창 순변위 mm")}
    m = NEW / f"{tag}.json"
    if m.exists():
        M = json.load(open(m, encoding="utf-8"))
        r.update(n=M["n"], 정착프레임=M["frames"], 수렴=M["converged"],
                 s_per_frame=M["secPerFrame"], vs정본중앙=M["vs정본blob_mm"]["중앙"], sec=M["sec"])
    fit = NEW / f"fit-{tag}.json"
    if fit.exists():
        F = json.load(open(fit, encoding="utf-8"))
        r["층3행"] = len(F["rows"])
        r["press합"] = sum(x["pressN"] for x in F["rows"])
        r["층3중앙"] = {x["name"]: x["medMm"] for x in F["rows"]}
    rows[cell] = r
for t in sorted(NEW.glob("*.throw.json")):
    T = json.load(open(t, encoding="utf-8"))
    msg = " ".join((T.get("err") or "").split())
    hit = re.search(r"(옷 자기 간격 SEP 미달[^\\\"]*?mm)", msg)
    throws[cell_of(t.name[:-11])] = {"stage": T.get("stage"), "요지": hit.group(1) if hit else msg[-160:]}

old = {}
if OLD:
    for g in sorted(Path(OLD).glob("gate-*.json")):
        G = json.load(open(g, encoding="utf-8"))
        old[g.name[5:-5]] = {"pass": G["pass"], "fails": G["fails"], "채널": G["채널"],
                             "창순변위 mm": (G.get("정착") or {}).get("창 순변위 mm")}
    for t in Path(OLD).glob("*.throw.json"):
        old[t.name[:-11]] = {"throw": True}

fail_kind = Counter()
for r in rows.values():
    for f in r["fails"]:
        fail_kind[f.split(" ")[0]] += 1

size_of = lambda c: c.rsplit("_", 1)[1]
by_size = {}
for s in ("S", "M", "L", "XL"):
    cs = [c for c in rows if size_of(c) == s]
    ts = [c for c in throws if size_of(c) == s]
    by_size[s] = {"굽기": len(cs), "pass": sum(1 for c in cs if rows[c]["pass"]),
                  "fail": sum(1 for c in cs if not rows[c]["pass"]), "던짐": len(ts)}

cmp_rows = []
if old:
    for cell in sorted(set(list(rows) + list(throws) + list(old))):
        o = old.get(cell)
        o_state = "던짐" if (o or {}).get("throw") else ("pass" if o and o["pass"] else "fail" if o else "없음")
        o_re = None
        if o and not o.get("throw"):
            o_re = "pass" if not rejudge(o["채널"], o["창순변위 mm"]) else "fail"
        n_state = "던짐" if cell in throws else ("pass" if rows.get(cell, {}).get("pass") else
                                                "fail" if cell in rows else "없음")
        cmp_rows.append({"cell": cell, "v4-46": o_state, "v4-46 재판정(지금 자)": o_re, "v5-27(asm1x)": n_state})

out = {
    "what": "v5-27 §1-③ 108칸 집계(측정만 · 판정은 게이트 산출을 읽어 센다)",
    "_args": {"NEW": str(NEW), "OLD": str(OLD) if OLD else None},
    "문턱(인용)": {"③a mm": PEN_MAX, "자기관통 허용 mm": ALLOW_MM, "정착 mm": SETTLE_MM},
    "처리": len(rows) + len(throws), "굽기": len(rows), "던짐": len(throws),
    "pass": sum(1 for r in rows.values() if r["pass"]),
    "fail": sum(1 for r in rows.values() if not r["pass"]),
    "fail 부류": dict(fail_kind), "사이즈별": by_size,
    "던짐 전량": throws,
    "층3": {"5행 성립": sum(1 for r in rows.values() if r.get("층3행") == 5),
           "press 0 인 칸": sum(1 for r in rows.values() if r.get("press합") == 0)},
    "정착": {"수렴": sum(1 for r in rows.values() if r.get("수렴")),
            "미수렴": sum(1 for r in rows.values() if r.get("수렴") is False)},
    "시간": {"총 s": round(sum(r.get("sec", 0) for r in rows.values()), 1)},
    "v4-46 대비": ({"그때 pass": sum(1 for c in old.values() if not c.get("throw") and c["pass"]),
                  "그때 fail": sum(1 for c in old.values() if not c.get("throw") and not c["pass"]),
                  "그때 던짐": sum(1 for c in old.values() if c.get("throw")),
                  "그때 산출을 «지금 자»로 재판정한 pass":
                      sum(1 for c in old.values() if not c.get("throw") and not rejudge(c["채널"], c["창순변위 mm"])),
                  "칸별": cmp_rows} if old else None),
    "전량": rows,
}


def med(v):
    v = sorted(v)
    return v[len(v) // 2] if v else None


sp = [r["s_per_frame"] for r in rows.values() if "s_per_frame" in r]
fr = [r["정착프레임"] for r in rows.values() if "정착프레임" in r]
vs = [r["vs정본중앙"] for r in rows.values() if "vs정본중앙" in r]
out["시간"].update({"s/프레임 중앙": med(sp), "s/프레임 최대": max(sp) if sp else None})
out["정착"].update({"f 최소": min(fr) if fr else None, "f 중앙": med(fr), "f 최대": max(fr) if fr else None})
out["vs 정본 중앙 mm"] = {"최소": min(vs) if vs else None, "중앙": med(vs), "최대": max(vs) if vs else None}
OUT.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
brief = {k: v for k, v in out.items() if k not in ("전량", "v4-46 대비", "던짐 전량")}
brief["v4-46 대비"] = {k: v for k, v in (out["v4-46 대비"] or {}).items() if k != "칸별"}
print(json.dumps(brief, ensure_ascii=False, indent=1))
