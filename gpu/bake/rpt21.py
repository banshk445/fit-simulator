"""v4-21 §1-① 층3 대조 인쇄(읽기만 · 계산 0)."""
import json
from pathlib import Path
E, R = Path("gpu/oracle/export"), Path("gpu/bake/results/v4-21-Tramp")
c = json.load(open(E / "l3-product-cmp-v4-21-Tramp.json", encoding="utf-8"))
print("요약", c["요약"])
for r in c["rows"]:
    print(f"  {r['행']} {r['표시값_1자리']['A']}/{r['표시값_1자리']['B']} "
          f"{r['대역이름']['A']}/{r['대역이름']['B']} n {r['대역정의역_n']['A']}/{r['대역정의역_n']['B']} "
          f"중앙차 {r['차_mm']['중앙']:+.6f} 소속 {r['정점대역소속']['A']}/{r['정점대역소속']['B']}")
g = json.load(open(R / "gate-Tasm_M.json", encoding="utf-8"))
g3 = json.load(open(E / "l3-gate-c100-h170-s45_M-v3정본.json", encoding="utf-8"))
print("게이트 v3정본", g3["pass"], g3["fails"])
print("게이트 램프판", g["pass"], g["fails"])
for k in ("③a 관통 최대 mm", "자기관통 교차", "목선 초과비", "최소 쌍거리 mm"):
    print("  ", k, round(g3["채널"][k], 6), "/", round(g["채널"][k], 6))
print("  정착", round(g3["정착"]["창 순변위 mm"], 6), "/", round(g["정착"]["창 순변위 mm"], 6))
m = json.load(open(R / "Tasm_M.json", encoding="utf-8"))
print("정착", m["convFrame"], "net %.6e" % m["lastNet"], "s/프레임 %.3f" % m["secPerFrame"])
print("ramp", m["ramp"], "inputMode", m["inputMode"])
print("궤적", [(f, "%.3e" % v) for f, v in m["trail"][:4]], "...", [(f, "%.3e" % v) for f, v in m["trail"][-3:]])
