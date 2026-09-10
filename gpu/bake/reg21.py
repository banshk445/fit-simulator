"""v4-21 §2 — 워커 «두 기존 모드» 회귀(각 1칸 바이트 대조 · 계산 0 · 물리 0)."""
import hashlib
from pathlib import Path
sha = lambda p: hashlib.sha256(Path(p).read_bytes()).hexdigest()
pairs = [("기존 정착-blob 모드", "gpu/bake/results/v4-21-회귀A/c100-h185-s40_L.bin",
          "gpu/oracle/export/l3br-c100-h185-s40_L-f64-cuda.bin"),
         ("조립 모드(v4-20 상태 · 램프 없음)", "gpu/bake/results/v4-21-회귀B/Tasm_M.bin",
          "gpu/bake/results/v4-20-Tasm/Tasm_M.bin")]
for name, a, b in pairs:
    ea, eb = Path(a).exists(), Path(b).exists()
    if not (ea and eb):
        print(f"{name}: 파일 없음 a={ea} b={eb}")
        continue
    ha, hb = sha(a), sha(b)
    print(f"{name}: {'비트 동일' if ha == hb else '★다름'} · {ha[:16]} / {hb[:16]}")
