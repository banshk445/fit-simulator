"""v4-18 §1-③ 회귀 — 조립 해시 «전/후» 대조(계산 0 · 물리 0)."""
import json
import sys
from pathlib import Path

E = Path("gpu/oracle/export")
A = json.load(open(E / f"l3asm-{sys.argv[1]}.json", encoding="utf-8"))
B = json.load(open(E / f"l3asm-{sys.argv[2]}.json", encoding="utf-8"))
ra = {r["cell"]: r for r in A["rows"]}
rb = {r["cell"]: r for r in B["rows"]}
same = diff = other = 0
bad = []
for c, x in ra.items():
    y = rb.get(c)
    if x.get("상태") != "ok" or (y or {}).get("상태") != "ok":
        other += 1
        continue
    if x["posSha"] == y["posSha"] and x["uvSha"] == y["uvSha"] and x["n"] == y["n"] and x["m"] == y["m"]:
        same += 1
    else:
        diff += 1
        bad.append({"cell": c, "before": {k: x[k] for k in ("posSha", "uvSha", "n", "m")},
                    "after": {k: y[k] for k in ("posSha", "uvSha", "n", "m")}})
out = {"what": "v4-18 §1-③ T포즈 조립 회귀(비트 동일)", "before": sys.argv[1], "after": sys.argv[2],
       "칸": len(ra), "조립 성공(양쪽)": same + diff, "비트 동일": same, "불일치": diff,
       "조립 못 한 칸(양쪽 공통 제외)": other, "불일치 목록": bad[:10]}
json.dump(out, open(E / "l3asm-diff.json", "w", encoding="utf-8"), indent=1, ensure_ascii=False)
print(json.dumps(out, ensure_ascii=False, indent=1))
