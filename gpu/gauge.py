"""v4-07 §1 — **계기 교정 훑기의 집계기**(v3↔v3 만 · v4 미사용).

`scripts/v4CellConverge.ts` 가 낸 `cellconv7-*.bin` 을 읽어 **보존비**를 낸다.

```
 보존비 = (최종 좌표차 최대) / ε        적격 = 보존비 ≤ 0.01   ← v4-05 §0-5 문면 그대로(이동 0)
 최종 좌표차 = max_{v,축} |pos_ε[v,축] − pos_0[v,축]|   ← v4-04~06 과 «같은 식»
```

이 파일에 **새 수는 0**이다 — 문턱도 섭동 값도 여기서 정하지 않는다(둘 다 인용/인자).
진입: `py gpu/gauge.py`
"""
import json
import struct
import sys
from pathlib import Path

import numpy as np

EXPORT = Path(__file__).resolve().parent / "oracle" / "export"
CELL = "c100-h170-s45_M"
KIND = "all"
QUAL = 0.01                       # v4-05 §0-5 · 이동 0


def read(tag, off):
    """(헤더, 위치 n×3) — 없으면 (None, None)."""
    p = EXPORT / f"cellconv7-{CELL}-{KIND}-e{tag}-x{off}.bin"
    if not p.exists():
        return None, None
    raw = p.read_bytes()
    (hl,) = struct.unpack_from("<I", raw, 0)
    h = json.loads(raw[4:4 + hl].decode("utf-8"))
    n = h["n"]
    pos = np.frombuffer(raw, dtype="<f8", count=n * 3, offset=4 + hl).reshape(n, 3)
    return h, pos


def summary(tag):
    p = EXPORT / f"cellconv7-{CELL}-{KIND}-e{tag}-sum.json"
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else None


def stats(a, b, eps=None):
    d = np.abs(a - b)                       # 좌표별 차(축 분해가 되게 둔다)
    per_v = d.max(axis=1)
    r = dict(mx=float(d.max()), med=float(np.median(per_v)), p99=float(np.percentile(per_v, 99)),
             ax=[float(d[:, i].max()) for i in range(3)],
             dist_mx=float(np.linalg.norm(a - b, axis=1).max()),
             rigid=float(np.abs((a - b).mean(axis=0)).max()),      # 강체 성분(평균 변위)
             argmax=int(per_v.argmax()))
    if eps:
        r["over"] = int((per_v > eps).sum())                       # 잔차 > ε 인 정점 수
        r["over_pct"] = 100.0 * r["over"] / per_v.size
        inner = (a - b) - (a - b).mean(axis=0)                     # 강체를 뺀 나머지
        r["inner_mx"] = float(np.abs(inner).max())
    return r


EPS = [("1e-7", 1e-7), ("1e-6", 1e-6), ("1e-5", 1e-5),
       ("1e-4", 1e-4), ("1e-3", 1e-3), ("1e-2", 1e-2)]
EXTS = [0, 50, 100, 200, 400]


def main():
    h0, p0 = read("0", 0)
    if p0 is None:
        sys.exit("기본(ε=0 · 연장 0) 스냅이 없다 — 훑기를 먼저 돌린다")
    s0 = summary("0") or dict(converged=None, convFrame=h0["convFrame"], convNet=h0["convNet"],
                              ms=h0["ms"], msPerFrame=h0["ms"] / max(h0["frame"], 1), partial=True)
    print(f"■ 기본 ε=0 — 수렴 {s0['converged']} · 수렴프레임 {s0['convFrame']} · "
          f"수렴시점 창 순변위 {s0['convNet']:.6e} m · {s0['ms']/1000:.0f}s "
          f"({s0['msPerFrame']/1000:.2f} s/프레임)"
          + ("   ← 진행 중(부분 집계)" if s0.get("partial") else ""))
    print()

    print("── ㄱ 섭동 훑기 (연장 0 · 수렴 선언 시점) ─────────────────────────")
    print(f"{'ε(m)':>8} {'수렴':>5} {'프레임':>6} {'수렴시점net':>13} {'최종차 최대':>13} "
          f"{'보존비(최대)':>12} {'적격':>5} {'최종차 중앙':>13} {'보존비(중앙)':>12} {'강체/ε':>8} {'잔차>ε':>8}")
    rows_a = []
    for tag, eps in EPS:
        h, p = read(tag, 0)
        if p is None:
            print(f"{tag:>8}   (미도착)")
            continue
        s = summary(tag) or dict(converged=None, convFrame=h["convFrame"], convNet=h["convNet"])
        st = stats(p, p0, eps)
        gain = st["mx"] / eps
        ok = "✅" if gain <= QUAL else "❌"
        gmed = st["med"] / eps
        print(f"{tag:>8} {str(s['converged']):>5} {s['convFrame']:>6} {s['convNet']:>13.6e} "
              f"{st['mx']:>13.6e} {gain:>12.6g} {ok:>5} {st['med']:>13.4e} {gmed:>12.4f} "
              f"{st['rigid']/eps:>8.4f} {st['over_pct']:>7.1f}%")
        rows_a.append(dict(eps=eps, tag=tag, gain=gain, gain_med=gmed, conv=s["converged"],
                           frames=s["convFrame"], convNet=s["convNet"], **st))
    print()

    print("── ㄴ 연장 훑기 (ε=1e-4 고정 · 수렴 «후» 추가 프레임) ─────────────")
    print(f"{'연장':>6} {'기본프레임':>10} {'섭동프레임':>10} {'기본net':>11} {'섭동net':>11} "
          f"{'최종차 최대':>13} {'보존비(최대)':>12} {'적격':>5} {'보존비(중앙)':>12} "
          f"{'강체/ε':>8} {'내부최대/ε':>10} {'기본자기이동':>13} {'대조비':>8}")
    print("      ★ 기본자기이동 = 기본 실행의 x0 ↔ x<연장> 좌표차 최대 — 「차이가 섭동 몫인가 «시계» 몫인가」의 자")
    rows_b = []
    for off in EXTS:
        hb, pb = read("0", off)
        hp, pp = read("1e-4", off)
        if pb is None or pp is None:
            print(f"{off:>6}   (미도착)")
            continue
        st = stats(pp, pb, 1e-4)
        gain, gmed = st["mx"] / 1e-4, st["med"] / 1e-4
        ok = "✅" if gain <= QUAL else "❌"
        self_mv = float(np.abs(pb - p0).max())            # 기본 실행이 «스스로» 움직인 양
        ratio = st["mx"] / self_mv if self_mv > 0 else float("inf")
        print(f"{off:>6} {hb['frame']:>10} {hp['frame']:>10} {hb['net']:>11.3e} {hp['net']:>11.3e} "
              f"{st['mx']:>13.6e} {gain:>12.6g} {ok:>5} {gmed:>12.4f} "
              f"{st['rigid']/1e-4:>8.4f} {st['inner_mx']/1e-4:>10.4f} {self_mv:>13.6e} {ratio:>8.2f}")
        rows_b.append(dict(ext=off, gain=gain, gain_med=gmed, fb=hb["frame"], fp=hp["frame"],
                           netb=hb["net"], netp=hp["net"], self_move=self_mv, ratio=ratio, **st))
    print()

    # ── 「최대」 채널이 «어느 정점»을 집는가 — 채널 안정성 진단(판정 아님) ──
    tops, top5 = {}, {}
    for tag, eps in EPS:
        _, p = read(tag, 0)
        if p is None:
            continue
        per = np.abs(p - p0).max(axis=1)
        o = np.argsort(per)[::-1]
        tops[tag] = set(o[:50].tolist())
        top5[tag] = [(int(i), float(per[i] / eps)) for i in o[:5]]
    if tops:
        print("── 채널 안정성 — 「최대」가 집는 정점이 ε 사이에 겹치는가 ──────────")
        ks = list(tops)
        print("       " + " ".join(f"{k:>6}" for k in ks) + "   (상위50 교집합 크기)")
        for a in ks:
            print(f"{a:>6} " + " ".join(f"{len(tops[a] & tops[b]):>6}" for b in ks))
        print("  상위5(정점:보존비): " + " | ".join(
            f"{k} " + ",".join(f"{i}:{g:.1f}" for i, g in v) for k, v in top5.items()))
        print()

    out = EXPORT / "gauge7-summary.json"
    out.write_text(json.dumps(dict(cell=CELL, kind=KIND, qual=QUAL,
                                   base=s0, sweep_eps=rows_a, sweep_ext=rows_b,
                                   top5={k: v for k, v in top5.items()},
                                   top50_overlap={a: {b: len(tops[a] & tops[b]) for b in tops}
                                                  for a in tops}),
                              indent=1), encoding="utf-8")
    print(f"→ {out}")


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "extract":
        pass          # 아래 __main__ 뒷단에서 처리(정의 순서 때문에 함수 뒤로 미룬다)
    else:
        main()


def extract(tag, off, dst):
    """§1-④ 용 — 스냅에서 «위치만» 헤더 없는 f64 3n 으로 뽑는다(`v4FitReport.ts:POS`)."""
    _, pos = read(tag, off)
    if pos is None:
        sys.exit(f"스냅 없음 — e{tag} x{off}")
    np.ascontiguousarray(pos, dtype="<f8").tofile(dst)
    print(f"→ {dst} ({pos.shape[0]}×3 f64)")


if __name__ == "__main__" and len(sys.argv) > 1 and sys.argv[1] == "extract":
    extract(sys.argv[2], int(sys.argv[3]), sys.argv[4])
