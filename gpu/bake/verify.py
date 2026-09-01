"""v4-17 §1-①ㄹ — 워커 산출 ↔ v4-15 산출 **바이트 대조**(§0-5ㄱ). 계산 0 · 물리 0."""
import hashlib
import json
import sys
from pathlib import Path

J = json.load(open(sys.argv[1] if len(sys.argv) > 1 else "gpu/bake/jobs/v4-15-8칸.json",
                   encoding="utf-8"))
rows, ok = [], 0
for c in J["cells"]:
    a = Path(f"gpu/bake/results/{J['name']}/{c}.bin")
    b = Path(f"gpu/oracle/export/l3br-{c}-f64-cuda.bin")
    if not a.exists():
        rows.append({"cell": c, "상태": "미생성"})
        continue
    ha = hashlib.sha256(a.read_bytes()).hexdigest()
    hb = hashlib.sha256(b.read_bytes()).hexdigest()
    ok += ha == hb
    rows.append({"cell": c, "상태": "비트 동일" if ha == hb else "★다름",
                 "worker_sha": ha[:16], "v4_15_sha": hb[:16]})
    m = json.load(open(f"gpu/bake/results/{J['name']}/{c}.json", encoding="utf-8"))
    rows[-1].update(정착=m["convFrame"], s_per_frame=round(m["secPerFrame"], 3),
                    jit=round(m["jitSec"], 1))
out = {"what": "v4-17 §1-①ㄹ 워커 ↔ v4-15 바이트 대조", "job": J["name"],
       "비트 동일": f"{ok}/{len(J['cells'])}", "rows": rows}
json.dump(out, open(f"gpu/bake/results/{J['name']}/verify.json", "w", encoding="utf-8"),
          indent=1, ensure_ascii=False)
print(json.dumps(out, ensure_ascii=False, indent=1))
