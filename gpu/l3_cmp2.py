"""v4-09 §1-② — **표본 규칙 «검증»기**. 규칙은 전략 세션이 정했고(§0-4) CC 는 «검증»만 한다.

규칙(집행 «전» 등재 · 이 파일이 정하는 것은 하나도 없다):
```
 중심    = **v3@180**(같은 정의역 · `fit-…-v3-e0-x100.json`) — 정본 blob 이 아니다
 잡음군  = **ε ≤ 1e-4** 인 v3 최종 상태(중심 제외) — 근거 = s4Gate.settleNetM = 1e-4 m
 문턱    = 채널별 표본 σ(ddof=1) × **k = 3**(v4-08 문면 그대로 · 이동 0)
 검증    = **ε=5e-5 는 15채널 «전부» 3σ 안** 이고 **ε=2e-4 는 «적어도 한» 채널에서 3σ 초과**
          ⟹ (가) 예측대로 · 어긋나면 (나) **규칙 폐기**(경계 재선정·보정 0)
```
진입: `py gpu/l3_cmp2.py`
"""
import json
import statistics as st
from pathlib import Path

E = Path(__file__).resolve().parent / "oracle" / "export"
CELL = "c100-h170-s45_M"
CENTER = "v3-e0-x100"                                  # v3@180
NOISE = ["v3-e0-x0", "v3-e0-x50", "v3-e0-x200", "v3-e0-x400",
         "v3-e1e-7-x0", "v3-e1e-6-x0", "v3-e1e-5-x0",
         "v3-e1e-4-x0", "v3-e1e-4-x50", "v3-e1e-4-x100", "v3-e1e-4-x200", "v3-e1e-4-x400"]
CHECK = {"ε=5e-5 (경계 «안» · 0.5배)": "v3-e5e-5-x100",
         "ε=2e-4 (경계 «밖» · 2배)": "v3-e2e-4-x100"}
SIGNAL = {"ε=1e-3 (신호)": "v3-e1e-3-x0", "ε=1e-2 (신호)": "v3-e1e-2-x0"}
KEYS = [("p25Mm", "p25"), ("medMm", "중앙"), ("p75Mm", "p75")]

rd = lambda t: json.load(open(E / f"fit-{CELL}-{t}.json", encoding="utf-8"))
c = rd(CENTER)
S = {t: rd(t) for t in NOISE}
ROWS = [r["name"] for r in c["rows"]]

thr, out = {}, {"cell": CELL, "center": CENTER, "k": 3, "noiseN": len(NOISE), "rows": {}}
print(f"=== §1-② 잡음군 분포 · 중심 = {CENTER}(v3@180) · 표본 {len(NOISE)} (ε ≤ 1e-4 · 중심 제외) ===")
print(f"{'행.채널':<12}{'중심':>10}{'표본최소':>10}{'표본최대':>10}{'σ':>12}{'문턱 3σ':>12}{'잡음군 최대편차':>16}")
for i, rn in enumerate(ROWS):
    for k, kn in KEYS:
        b = c["rows"][i][k]
        vals = [S[t]["rows"][i][k] for t in NOISE]
        sd = st.stdev(vals)
        thr[(rn, kn)] = (b, 3 * sd)
        dm = max(abs(v - b) for v in vals)
        out["rows"][f"{rn}.{kn}"] = {"center": b, "sd": sd, "thr3sd": 3 * sd,
                                     "min": min(vals), "max": max(vals), "noiseDevMax": dm}
        print(f"{rn + '.' + kn:<12}{b:10.4f}{min(vals):10.4f}{max(vals):10.4f}"
              f"{sd:12.4e}{3 * sd:12.4e}{dm:16.4e}")

out["verdict"] = {}
for label, tag in list(CHECK.items()) + list(SIGNAL.items()):
    try:
        R = rd(tag)
    except FileNotFoundError:
        print(f"\n[{label}] 리포트 부재 — 건너뜀")
        continue
    over = []
    print(f"\n--- {label}  [{tag}] ---")
    print(f"{'행.채널':<12}{'중심':>10}{'값':>10}{'편차':>11}{'문턱 3σ':>11}  판정")
    for i, rn in enumerate(ROWS):
        for k, kn in KEYS:
            b, tv = thr[(rn, kn)]
            v = R["rows"][i][k]
            d = abs(v - b)
            if d > tv:
                over.append(f"{rn}.{kn}")
            print(f"{rn + '.' + kn:<12}{b:10.4f}{v:10.4f}{d:11.4f}{tv:11.4f}  "
                  f"{'안' if d <= tv else '★밖'}")
    print(f"  ⟹ 3σ 초과 {len(over)}/15" + (f" — {', '.join(over)}" if over else " · **전 채널 잡음군 안**"))
    out["verdict"][tag] = {"label": label, "over": over,
                           "rows": {f"{rn}.{kn}": {"v": R["rows"][i][k],
                                                   "dev": abs(R["rows"][i][k] - thr[(rn, kn)][0]),
                                                   "thr": thr[(rn, kn)][1]}
                                    for i, rn in enumerate(ROWS) for k, kn in KEYS}}

a = out["verdict"].get("v3-e5e-5-x100")
b_ = out["verdict"].get("v3-e2e-4-x100")
if a and b_:
    ok = (len(a["over"]) == 0) and (len(b_["over"]) >= 1)
    out["ruleVerdict"] = "가" if ok else "나"
    print(f"\n★ 규칙 검증 — ε=5e-5 초과 {len(a['over'])}/15(0 이어야 한다) · "
          f"ε=2e-4 초과 {len(b_['over'])}/15(1 이상이어야 한다) ⟹ **({out['ruleVerdict']})**")
json.dump(out, open(E / "l3-rule-verdict.json", "w", encoding="utf-8"), indent=1, ensure_ascii=False)
print(f"\n→ {E / 'l3-rule-verdict.json'}")
