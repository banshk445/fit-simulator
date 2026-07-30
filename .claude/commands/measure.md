---
description: 현재 상태의 톱니/봉제선갭/관통 지표를 한 번에 측정
---

브라우저 콘솔에서 접근 가능한 window.__fitDebug 함수들로 현재 상태를
측정한다. 코드는 고치지 않는다.

1. seamNormalJaggedness() — armhole/sleeve 성분 분리해서 row0~11 전 구간
2. sleeveSeamCheck() — 봉제선 갭 (k=0~11)
3. 관통량 (armCapsuleRowCheck 등 관련 함수)

결과를 표로 정리하고, docs/pattern-redesign.md의 마지막 베이스라인과
비교해서 개선/악화/무변화 표시.
