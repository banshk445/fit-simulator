"""v4-08 §1-①② — **층3 대조기**. 핏 리포트 5행의 v3↔v3 분포에서 문턱을 «유도»하고 v4 를 판정한다.

이 파일에 리포트 «식»은 0줄이다 — `scripts/v4FitReport.ts` 가 낸 JSON 만 읽는다.

문턱 규칙은 **v4-08 §0-5′ 에 «집행 전» 등재된 그대로**다(사후 조정 0 · 함정 14):
  · 표본 = ①이 산출한 **v3 최종 상태 «전량»**(ε 6값 × 연장 조건 · 15개) · v3 정본은 표본에서 «뺀다»
  · 문턱 = 행·채널별 **표본표준편차(ddof=1) × 3**  — k=3 의 출처는 «정규분포 3σ»라는 문면이다
  · 편차 = |리포트값 − **v3 정본** 리포트값| (mm) · 채널 = 행마다 **p25 · 중앙 · p75** 셋

진입: `py gpu/l3_cmp.py [v4태그 …]`   (예: `py gpu/l3_cmp.py v4-f180 v3-e0-x100`)
"""
import json
import statistics as st
import sys
from pathlib import Path

E = Path(__file__).resolve().parent / "oracle" / "export"
CELL = "c100-h170-s45_M"
SAMPLES = ["e0-x0", "e0-x50", "e0-x100", "e0-x200", "e0-x400",
           "e1e-7-x0", "e1e-6-x0", "e1e-5-x0",
           "e1e-4-x0", "e1e-4-x50", "e1e-4-x100", "e1e-4-x200", "e1e-4-x400",
           "e1e-3-x0", "e1e-2-x0"]
KEYS = [("p25Mm", "p25"), ("medMm", "중앙"), ("p75Mm", "p75")]


def rd(tag):
    return json.load(open(E / f"fit-{CELL}-{tag}.json", encoding="utf-8"))


base = rd("v3blob")
S = {t: rd("v3-" + t) for t in SAMPLES}
ROWS = [r["name"] for r in base["rows"]]

thr, out = {}, {"cell": CELL, "k": 3, "rule": "v4-08 §0-5′ (집행 전 등재)", "rows": {}}
print("=== §1-① v3↔v3 분포 · 문턱 «유도» (mm · 기준 = v3 정본 blob · 표본 15) ===")
print(f"{'행.채널':<12}{'정본':>10}{'표본최소':>10}{'표본최대':>10}{'σ':>12}{'문턱 3σ':>12}{'최대편차':>12}")
for i, rn in enumerate(ROWS):
    for k, kn in KEYS:
        b = base["rows"][i][k]
        vals = [S[t]["rows"][i][k] for t in SAMPLES]
        dev = {t: abs(v - b) for t, v in zip(SAMPLES, vals)}
        sd = st.stdev(vals)
        thr[(rn, kn)] = (b, 3 * sd)
        out["rows"][f"{rn}.{kn}"] = {"base": b, "sd": sd, "thr3sd": 3 * sd,
                                     "min": min(vals), "max": max(vals),
                                     "devMax": max(dev.values()), "dev": dev}
        print(f"{rn + '.' + kn:<12}{b:10.4f}{min(vals):10.4f}{max(vals):10.4f}"
              f"{sd:12.4e}{3 * sd:12.4e}{max(dev.values()):12.4e}")

print("\n=== 표본별 |편차| (mm) — 분포 «형태» ===")
hd = f"{'표본':<12}" + "".join(f"{rn + '.' + kn:>11}" for rn in ROWS for _, kn in KEYS)
print(hd)
for t in SAMPLES:
    print(f"{t:<12}" + "".join(f"{out['rows'][f'{rn}.{kn}']['dev'][t]:11.4f}"
                               for rn in ROWS for _, kn in KEYS))

for tag in sys.argv[1:]:
    try:
        R = rd(tag)
    except FileNotFoundError:
        print(f"\n[{tag}] 리포트 파일 부재 — 건너뜀")
        continue
    print(f"\n=== §1-② 판정 · {tag} (문턱 = 위 3σ · 이동 0) ===")
    print(f"{'행.채널':<12}{'v3 정본':>10}{'v4':>10}{'편차':>11}{'문턱 3σ':>11}  판정")
    bad = []
    for i, rn in enumerate(ROWS):
        for k, kn in KEYS:
            b, tv = thr[(rn, kn)]
            v = R["rows"][i][k]
            d = abs(v - b)
            ok = d <= tv
            if not ok:
                bad.append(f"{rn}.{kn}")
            print(f"{rn + '.' + kn:<12}{b:10.4f}{v:10.4f}{d:11.4f}{tv:11.4f}  {'통과' if ok else '★초과'}")
    print(f"  ⟹ 초과 {len(bad)}/15 채널" + (f" — {', '.join(bad)}" if bad else " · **전 채널 문턱 안**"))
    out.setdefault("verdict", {})[tag] = {"over": bad,
        "rows": {f"{rn}.{kn}": {"v": R["rows"][i][k], "dev": abs(R["rows"][i][k] - thr[(rn, kn)][0]),
                                "thr": thr[(rn, kn)][1]}
                 for i, rn in enumerate(ROWS) for k, kn in KEYS}}

json.dump(out, open(E / "l3-verdict.json", "w", encoding="utf-8"), indent=1, ensure_ascii=False)
print(f"\n→ {E / 'l3-verdict.json'}")
