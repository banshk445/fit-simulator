---
tags: [함정]
---
# 함정 4 — PBD Gauss-Seidel은 stiffness>1에서 불안정
반복 보정이 있으면 유효강성이 1-(1-k)^n으로 복리 누적됨.
보정식: k' = 1-(1-k)^(1/n)

관련: 하모닉/XPBD 검토 시 재확인 대상 — v2-design §에서 XPBD 기각 근거 중 하나
("반복 보정 강성이 이미 있어 stiffness>1 카오스는 XPBD로도 안 풀림").
