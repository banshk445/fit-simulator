"""v4-03 §1-① — **오차 상한의 «재유도»**(완화 아님). 전략 세션 v4-02 §4 처분.

v4-02 의 상한 `M × 4·ULP_f32` 는 **M(스텝 수)만 세고 스텝 «안»에서 도는 연산 사슬을 세지 않았다.**
한 스텝은 제약 수만 번의 가우스–자이델 투영을 돌고, 한 정점은 자기가 속한 제약 수만큼 «거듭»
갱신된다 — 그 사슬을 4 로 잡은 것이 초과(1.224배)의 원인이었다(f64 재현 2.22e-16 이 이식의
정확성을 증명했다). **귀책 = 전략 세션.**

재유도한 형식:

    상한 = K × ULP_f32(그 자리 값) × M

`K` 는 **커널 코드에서 «센» 수**다 — 실측을 보고 고르지 않는다(v4-03 §0-4 절차).
세는 규칙(§0-4 등재분): **나눗셈·`sqrt`·`atan2` 는 각 1**(IEEE-754 기본 연산은 정확히 반올림된다),
곱셈·덧셈·뺄셈·부호반전도 각 1.

두 가지를 «둘 다» 센다 — 그리고 **작은 쪽으로 판정한다**(v4-02 와 같은 규범: 느슨한 쪽을 골라
통과를 만들지 않는다 · 함정 14):
  · **깊이 K_depth** — 갱신된 좌표가 «거치는» 의존 사슬의 길이(엄격한 쪽)
  · **총량 K_ops**  — 그 갱신이 의존하는 부동소수 연산의 총수(느슨한 쪽)
"""
import math

# ── 늘어남(inplane) — `gpu/engine/stretch.py:_project`(v4-02 커널 · 이 판에서 로직 diff 0) ──
#   성분 G00 / G11 / G01 이 «차례로» 돈다 ⟹ 한 제약이 한 좌표를 세 번 갱신한다.
#   깊이  17(G00) + 17(G11) + 19(G01) = 53      (세부는 docs/v4/03-굽힘.md §1-① 표)
#   총량  75      + 75      + 92      = 242
K_STRETCH_DEPTH_PER_CON = 53
K_STRETCH_OPS_PER_CON = 242

# ── 굽힘(bend) — `gpu/engine/bending.py:_project` ──
#   스칼라 제약 하나 ⟹ 한 제약이 한 좌표를 «한 번» 갱신한다.
#   깊이 24 · 총량 156      (세부는 docs/v4/03-굽힘.md §1-③ 표)
#   ★ 총량은 처음 121 로 적었다가 «전 항목 합산»으로 156 으로 고쳤다 — 산술 정정이다.
#     판정에 쓰는 것은 «깊이»(엄격한 쪽)이고 그 값은 24 로 «불변» ⟹ 갈래 판정에 영향 0.
K_BEND_DEPTH_PER_CON = 24
K_BEND_OPS_PER_CON = 156

# ── 몸 충돌(collide) — `gpu/engine/collide.py:_resolve`(+ `_sample`) ──
#   한 정점은 한 서브스텝에 충돌체 하나로 **한 번** 해소된다 ⟹ deg = 1.
#   `sampleSdf` 하나가 **깊이 10 · 33 연산**이고 법선 중심차분이 그것을 **6번** 더 부른다.
#   깊이 34 · 총량 282      (세부는 docs/v4/05-몸충돌.md §1-③ 표)
#   ★ 예측 단계(중력)가 앞에 **깊이 4** 를 더하지만 **세지 않는다** — 더 엄격한 쪽을 판정에 쓴다
#     (34 로 통과하면 38 로도 통과한다).
K_COLLIDE_DEPTH_PER_CON = 34
K_COLLIDE_OPS_PER_CON = 282

# ── 봉제(seam · 거리 제약) — `gpu/engine/seam.py:_project` ──
#   스칼라 제약 하나 ⟹ 한 제약이 한 좌표를 «한 번» 갱신한다.
#   깊이 12 · 총량 25      (세부는 docs/v4/06-봉제.md §1-① 표)
K_SEAM_DEPTH_PER_CON = 12
K_SEAM_OPS_PER_CON = 25


def ulp_f32(x: float) -> float:
    """|x| 자리의 ULP_f32. x=0 이면 0(그 자리에 크기가 없다)."""
    if x == 0:
        return 0.0
    return 2.0 ** (math.floor(math.log2(abs(x))) - 23)


def bound(k_per_con: int, deg: int, max_abs_coord: float, steps: int) -> float:
    """상한 = (K_제약 × deg) × ULP_f32(최대|좌표|) × M.

    `deg` = **한 정점이 속한 제약 수**(메시의 구조값이지 «측정값»이 아니다 — 함정 36 아님).
    한 스텝 안에서 그 정점의 좌표는 deg 번 갱신되므로 사슬이 deg 배로 는다.
    """
    return k_per_con * deg * ulp_f32(max_abs_coord) * steps


# ─── v4-04 §0-2 층1 — **1스텝 정확도**. M 이 없다(증폭이 일어날 시간이 없다) ───────────────
def ulp_f32_arr(x):
    """배열판 ULP_f32. 0 인 자리는 0(그 자리에 «자»가 없다)."""
    import numpy as np
    a = np.abs(np.asarray(x, dtype=np.float64))
    out = np.zeros_like(a)
    nz = a > 0
    out[nz] = 2.0 ** (np.floor(np.log2(a[nz])) - 23)
    return out


def layer1(diff, ref, k_per_con, deg=1):
    """층1 판정 — 정점마다 «그 자리 값»으로 자를 만들고 그 자로 오차를 잰다.

    「그 자리 값」 = **그 정점 위치의 최대 성분 크기**(v4-04 §0-2 ㄱ 등재).
      좌표 하나는 0 을 지날 수 있고 **0 에는 자가 없다** — 좌표값 단독을 자로 쓰지 않는다.
    상한 = `k_per_con × deg × ULP_f32(그 자리 값)`. **판정용 기본은 `deg = 1`**(더 엄격한 쪽 ·
      v4-04 §0-2 ㄴ). 돌려주는 것은 **정점별 (오차/상한) 비**의 배열이다.
    """
    import numpy as np
    d = np.max(np.abs(np.asarray(diff, dtype=np.float64)), axis=1)
    scale = np.max(np.abs(np.asarray(ref, dtype=np.float64)), axis=1)
    b = k_per_con * deg * ulp_f32_arr(scale)
    r = np.zeros_like(d)
    ok = b > 0
    r[ok] = d[ok] / b[ok]
    r[~ok] = np.where(d[~ok] > 0, np.inf, 0.0)     # 자가 없는데 오차가 있으면 «판정 불가»
    return r
