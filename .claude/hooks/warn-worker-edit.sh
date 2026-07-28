#!/bin/bash
# PostToolUse(Edit|Write) 훅 — garmentWorker/buildGarmentSim/clothPhysics 수정 시 하드 리프레시 안내.
input=$(cat)
if echo "$input" | grep -qE '"file_path"[[:space:]]*:[[:space:]]*"[^"]*(garmentWorker\.ts|buildGarmentSim\.ts|clothPhysics\.ts)"'; then
  echo "워커 관련 파일 수정됨 — 브라우저 하드 리프레시(Cmd+Shift+R) 필수, 새로고침만으로는 반영 안 됨" >&2
fi
exit 0
