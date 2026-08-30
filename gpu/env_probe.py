"""v4-01 §1-① — **환경 사실**(측정만 · 판정 0). 벤치 = 1e7 원소 벡터 덧셈."""
import platform, subprocess, sys, time
import taichi as ti

def chip():
    try:
        return subprocess.run(['sysctl','-n','machdep.cpu.brand_string'],
                              capture_output=True, text=True).stdout.strip()
    except Exception:
        return '?'

def gpu_cores():
    try:
        out = subprocess.run(['system_profiler','SPDisplaysDataType'],
                             capture_output=True, text=True).stdout
        for ln in out.splitlines():
            if 'Total Number of Cores' in ln:
                return ln.split(':')[1].strip()
    except Exception:
        pass
    return '?'

N = 10_000_000
def bench(arch, name):
    try:
        ti.init(arch=arch, default_fp=ti.f32)
    except Exception as e:
        return None, f'{type(e).__name__}: {e}'
    a = ti.field(ti.f32, shape=N); b = ti.field(ti.f32, shape=N); c = ti.field(ti.f32, shape=N)
    @ti.kernel
    def fill():
        for i in a: a[i] = i * 1e-7; b[i] = 1.0 - i * 1e-7
    @ti.kernel
    def add():
        for i in a: c[i] = a[i] + b[i]
    fill(); add(); ti.sync()                       # 워밍업(컴파일 제외)
    t0 = time.perf_counter(); add(); ti.sync(); dt = time.perf_counter() - t0
    return dt, None

print(f'기계        : {platform.node()}')
print(f'OS          : {platform.platform()}')
print(f'칩          : {chip()}')
print(f'GPU 코어    : {gpu_cores()}')
print(f'Python      : {sys.version.split()[0]}')
print(f'Taichi      : {".".join(map(str, ti.__version__))}')
for arch, name in [(ti.metal, 'metal'), (ti.cpu, 'cpu')]:
    dt, err = bench(arch, name)
    print(f'ti.init(arch={name:6s}) : ' + (f'**성공** · 1e7 벡터 덧셈 **{dt*1000:.3f} ms**' if err is None else f'**실패** — {err}'))
# ★ `ti.init` 은 요청 arch 가 없으면 **예외를 던지지 않고 «조용히» 폴백한다** ⟹
#   성공 여부는 반드시 **`ti.lang.impl.current_cfg().arch` 로 확인**한다(#121 계열 · 조용한 폴백).
for arch, name in [(ti.cuda, 'cuda'), (ti.metal, 'metal')]:
    ti.init(arch=arch, default_fp=ti.f32)
    got = ti.lang.impl.current_cfg().arch
    ok = got == arch
    print(f'ti.init(arch={name:6s}) → 실제 arch **{got}** · {"**요청대로**" if ok else "**폴백(요청 미충족)**"}')
