@echo off
REM v5-27 §1-③ — 108칸 본굽기(asm1x) 실행 파일. **ssh 세션과 «분리»해 띄우기 위한 자리**다.
REM   사고(v5-27 실측) — ssh 로 직접 띄우면 맥이 잠들거나 회선이 끊길 때 «원격 드라이버가 같이 죽는다».
REM   10시간 동안 .done 이 16칸에서 멈췄다(2호기는 잠든 적이 없다 — 절전 이벤트 0).
REM   ⟹ `Start-Process -WindowStyle Hidden` 으로 이 파일을 띄우고, 로그는 파일에 남긴다.
cd /d "%~dp0.."
set PYTHONIOENCODING=utf-8
set PYTHONUTF8=1
set ASM1X=1
set JOB_NAME=v5-27-A108x
set TAG_SUF=x
py scripts/bake108.py M S L XL >> gpu/bake/results/v5-27-A108x-run.log 2>&1
