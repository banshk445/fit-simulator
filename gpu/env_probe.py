"""v4-01 §1-① / v4-02 §1-① — **환경 사실**(측정만 · 판정 0). 벤치 = 1e7 원소 벡터 덧셈.

두 기계에서 **같은 스크립트**가 돌아야 회차 간 대조가 선다(v4-02 에서 2호기 갈래를 넣었다).
  · 에어 M4(darwin·arm64) → `metal` · `cpu`
  · 2호기(win32·x86_64)   → `cuda`  · `cpu`
★ `ti.init` 은 요청 arch 가 없어도 **예외를 던지지 않고 «조용히» 폴백한다**(v4-01 실측 · #121 계열) ⟹
  성공 여부는 반드시 **`ti.lang.impl.current_cfg().arch` 로 «값으로» 확인**한다.
"""
import platform, subprocess, sys, time
import taichi as ti

MAC = sys.platform == "darwin"


def _run(cmd):
    try:
        return subprocess.run(cmd, capture_output=True, text=True).stdout
    except Exception:
        return ""


def chip():
    if MAC:
        return _run(["sysctl", "-n", "machdep.cpu.brand_string"]).strip() or "?"
    return platform.processor() or "?"


def gpu_info():
    """(모델, VRAM, 드라이버, CUDA) — 맥은 (GPU 코어 수, '-', '-', '-')."""
    if MAC:
        for ln in _run(["system_profiler", "SPDisplaysDataType"]).splitlines():
            if "Total Number of Cores" in ln:
                return ln.split(":")[1].strip() + " 코어", "-", "-", "-"
        return "?", "-", "-", "-"
    q = _run(["nvidia-smi", "--query-gpu=name,memory.total,driver_version",
              "--format=csv,noheader"]).strip()
    name, vram, drv = ([p.strip() for p in q.split(",")] + ["?", "?", "?"])[:3] if q else ("?", "?", "?")
    cuda = "?"
    for ln in _run(["nvidia-smi"]).splitlines():
        if "CUDA" in ln and "Version" in ln:
            cuda = ln.split("CUDA")[-1].split("Version")[-1].strip(" :|")
            break
    return name, vram, drv, cuda


N = 10_000_000


def bench(arch):
    """(dt초, 실제arch, 오류원문). **폴백이면 dt 를 «측정하지 않는다»**(거짓 사실 방지)."""
    try:
        ti.init(arch=arch, default_fp=ti.f32)
    except Exception as e:
        return None, None, f"{type(e).__name__}: {e}"
    got = ti.lang.impl.current_cfg().arch
    if got != arch:
        return None, got, None
    a = ti.field(ti.f32, shape=N); b = ti.field(ti.f32, shape=N); c = ti.field(ti.f32, shape=N)

    @ti.kernel
    def fill():
        for i in a:
            a[i] = i * 1e-7
            b[i] = 1.0 - i * 1e-7

    @ti.kernel
    def add():
        for i in a:
            c[i] = a[i] + b[i]

    fill(); add(); ti.sync()                       # 워밍업(컴파일 제외)
    t0 = time.perf_counter(); add(); ti.sync(); dt = time.perf_counter() - t0
    return dt, got, None


if __name__ == "__main__":
    model, vram, drv, cuda = gpu_info()
    print(f'기계        : {platform.node()}')
    print(f'OS          : {platform.platform()}')
    print(f'칩          : {chip()}')
    print(f'GPU         : {model}')
    print(f'VRAM        : {vram}')
    print(f'드라이버    : {drv}')
    print(f'CUDA        : {cuda}')
    print(f'Python      : {sys.version.split()[0]}')
    print(f'Taichi      : {".".join(map(str, ti.__version__))}')
    cands = [(ti.metal, "metal"), (ti.cpu, "cpu")] if MAC else [(ti.cuda, "cuda"), (ti.cpu, "cpu")]
    for arch, name in cands:
        dt, got, err = bench(arch)
        if err is not None:
            print(f'ti.init(arch={name:6s}) : **실패** — {err}')
        elif dt is None:
            print(f'ti.init(arch={name:6s}) : **폴백** — 실제 arch **{got}** · 벤치 «측정 안 함»')
        else:
            print(f'ti.init(arch={name:6s}) : **성공** · 실제 arch **{got}** · 1e7 벡터 덧셈 **{dt*1000:.3f} ms**')
    # 요청 ↔ 실제 대조표(조용한 폴백을 «값으로» 드러낸다)
    for arch, name in [(ti.cuda, "cuda"), (ti.metal, "metal")]:
        try:
            ti.init(arch=arch, default_fp=ti.f32)
            got = ti.lang.impl.current_cfg().arch
            print(f'ti.init(arch={name:6s}) → 실제 arch **{got}** · '
                  f'{"**요청대로**" if got == arch else "**폴백(요청 미충족)**"}')
        except Exception as e:
            print(f'ti.init(arch={name:6s}) → **예외** {type(e).__name__}: {e}')
