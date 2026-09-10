"""v4-15 §1-①ㄷㄹ — **층3 다리**(칸마다 리포트 5행 · 제품 문턱 · 게이트 2건). 물리 0프레임.

계기는 **전부 인용**이다(수정 0) — `scripts/v4FitReport.ts` · `v4ProductCmp.ts` · `v4ProductGate.ts`.
이 파일이 하는 일은 **칸마다 같은 순서로 그 셋을 부르고, `NET` 을 산출물에서 «읽어» 넣는 것**뿐이다:
```
 v4 쪽 NET = 그 칸 실행의 마지막 창 순변위(`l3br-<cell>-f64-cuda.json` 의 lastNet)
 v3 쪽 NET = 그 칸 정본 blob 에서 «앞으로» 10프레임 간 창 순변위(`l3sc-v3net-<cell>.json` 의 netM)
   ★ 전방 창이다(§0-5ㄹ · v4-14 §1-③ㅁ 과 같은 처분).
```
진입: `py gpu/l3br_layer3.py [fp]`   (fp 기본 f64 · 표본은 `l3br-pick.json` 에서 읽는다)
"""
import json
import os
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from oracle import load  # noqa: E402

FPN = sys.argv[1] if len(sys.argv) > 1 else "f64"
E = load.EXPORT
pick = json.load(open(E / "l3br-pick.json", encoding="utf-8"))
cells = [r["cell"] for r in pick["표본"]]
if len(sys.argv) > 2:
    cells = sys.argv[2:]


def run(script, env):
    e = dict(os.environ, PYTHONIOENCODING="utf-8", **env)
    r = subprocess.run(["npx", "tsx", f"scripts/{script}"], env=e, shell=True,
                       capture_output=True, text=True, encoding="utf-8", errors="replace")
    if r.returncode != 0:
        raise RuntimeError(f"{script} {env} 실패\n{r.stdout[-2000:]}\n{r.stderr[-2000:]}")
    return r.stdout


rows = []
for c in cells:
    run_j = json.load(open(E / f"l3br-{c}-{FPN}-cuda.json", encoding="utf-8"))
    v3n = json.load(open(E / f"l3sc-v3net-{c}.json", encoding="utf-8"))
    pos = f"gpu/oracle/export/l3br-{c}-{FPN}-cuda.bin"
    tv3, tv4 = f"v3정본-{c}", f"v4-15-{c}-{FPN}"
    run("v4FitReport.ts", {"CELL": c, "TAG": tv3})
    run("v4FitReport.ts", {"CELL": c, "POS": pos, "TAG": tv4})
    run("v4ProductCmp.ts", {"A": f"gpu/oracle/export/fit-{c}-{tv3}.json",
                            "B": f"gpu/oracle/export/fit-{c}-{tv4}.json",
                            "TAG": f"{c}-{FPN}"})
    run("v4ProductGate.ts", {"CELL": c, "POS": f"public/v3diag/v3-77/settled-{c}.bin", "HDR": "1",
                             "NET": repr(float(v3n["netM"])), "TAG": tv3})
    run("v4ProductGate.ts", {"CELL": c, "POS": pos,
                             "NET": repr(float(run_j["lastNet"])), "TAG": tv4})
    cmp_j = json.load(open(E / f"l3-product-cmp-{c}-{FPN}.json", encoding="utf-8"))
    g3 = json.load(open(E / f"l3-gate-{c}-{tv3}.json", encoding="utf-8"))
    g4 = json.load(open(E / f"l3-gate-{c}-{tv4}.json", encoding="utf-8"))
    row = {"cell": c, "frames": run_j["frames"], "정착": run_j["converged"],
           "표시값": cmp_j["요약"]["표시값 1자리 일치"], "대역이름": cmp_j["요약"]["대역 이름 일치"],
           "정점소속": cmp_j["요약"]["정점 대역 소속 일치"], "대역n": cmp_j["요약"]["대역 정의역 n 일치"],
           "진단2자리": cmp_j["요약"]["진단 2자리 일치"],
           "pass_v3": g3["pass"], "pass_v4": g4["pass"], "pass일치": g3["pass"] == g4["pass"],
           "fails_v3": g3["fails"], "fails_v4": g4["fails"],
           "fails일치": sorted(g3["fails"]) == sorted(g4["fails"]),
           "관통v3": g3["채널"]["③a 관통 최대 mm"], "관통v4": g4["채널"]["③a 관통 최대 mm"],
           "교차v3": g3["채널"]["자기관통 교차"], "교차v4": g4["채널"]["자기관통 교차"],
           "정착mm_v3": g3["정착"]["창 순변위 mm"], "정착mm_v4": g4["정착"]["창 순변위 mm"],
           "같은옷3조건": (cmp_j["요약"]["표시값 1자리 일치"] == "5/5"
                      and cmp_j["요약"]["대역 이름 일치"] == "5/5"
                      and g3["pass"] == g4["pass"])}
    rows.append(row)
    print(f"{c:24s} f{row['frames']:<3d} 표시 {row['표시값']} 대역 {row['대역이름']} 소속 {row['정점소속']} "
          f"n {row['대역n']} 진단 {row['진단2자리']} pass {row['pass_v3']}/{row['pass_v4']} "
          f"3조건 {row['같은옷3조건']}", flush=True)

n_ok = sum(1 for r in rows if r["같은옷3조건"])
out = {"what": f"v4-15 §1-① 층3 다리({FPN})", "fp": FPN, "칸수": len(rows),
       "3조건 성립": f"{n_ok}/{len(rows)}", "rows": rows}
json.dump(out, open(E / f"l3br-layer3-{FPN}.json", "w", encoding="utf-8"), indent=1, ensure_ascii=False)
print(f"\n「같은 옷」 3조건 성립 = **{n_ok}/{len(rows)}**")
