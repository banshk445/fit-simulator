---
tags: [함정]
---
# 함정 5 — tsc -b가 scripts/ 안 잡음
scripts/는 tsconfig.scripts.json으로 별도 관리. nodenext로 바꾸면 안 됨.

부수 정정 (Stage 1a): "scripts tsc 구멍"이라 오진했던 사례가 있음 — 실은
루트 `tsc --noEmit`이 files:[]라 애초에 아무것도 검사 안 하고 있었던 것(명령 착오).
검사 명령은 항상 `tsc -b`로 통일.
