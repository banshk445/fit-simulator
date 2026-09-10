"""v4-20 §1-① 층3 대조 요약 인쇄(계산 0 · 읽기만)."""
import json
from pathlib import Path
E = Path("gpu/oracle/export")
g = json.load(open(E / "l3-gate-c100-h170-s45_M-v4-20-Tasm.json", encoding="utf-8"))
g3 = json.load(open(E / "l3-gate-c100-h170-s45_M-v3정본.json", encoding="utf-8"))
c = json.load(open(E / "l3-product-cmp-v4-20-Tasm.json", encoding="utf-8"))
print("게이트 v3정본 pass", g3["pass"], g3["fails"])
print("게이트 조립모드 pass", g["pass"], g["fails"])
for k in ("③a 관통 최대 mm", "자기관통 교차", "목선 초과비", "최소 쌍거리 mm"):
    print(f"  {k}: v3 {g3['채널'][k]} / asm {g['채널'][k]}")
print("정착", g3["정착"]["창 순변위 mm"], "/", g["정착"]["창 순변위 mm"])
print("요약", c["요약"])
for r in c["rows"]:
    print(f"  {r['행']} 표시 {r['표시값_1자리']['A']}/{r['표시값_1자리']['B']} "
          f"대역 {r['대역이름']['A']}/{r['대역이름']['B']} n {r['대역정의역_n']['A']}/{r['대역정의역_n']['B']} "
          f"중앙차 {r['차_mm']['중앙']:+.6f}")
