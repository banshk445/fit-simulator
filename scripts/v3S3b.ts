/* v3-12 — S3b 자기충돌. 정점–삼각형 + 엣지–엣지 · **흡착·인력 항 0**.
 *
 * 진입: `npm run v3:s3b`   (부분 실행: `ONLY=G,1,2 npm run v3:s3b`)
 *
 * 문턱은 실행 «전»에 고정한다:
 *   G 교차 판정기 자기검사 6/6      — 실패하면 ①을 «판정하지 않는다»
 *   ① 정지 상태 삼각형–삼각형 교차 0 (자기충돌 off 대조군은 교차 > 0 이어야 한다)
 *   ② 비인접 쌍 최소 거리 ≥ 2×두께 − 허용오차,  허용오차 = 0.1 mm (= 5% of 2mm)
 *      사유: 한 정점이 여러 접촉에 걸리면 순차 적용이 한 서브스텝에 완전 수렴하지
 *      않는다. 다음 서브스텝이 다시 밀므로 잔차는 «한 서브스텝의 재수렴» 폭이고,
 *      그 폭을 분리 거리의 5%로 «미리» 잡는다. 결과를 보고 고치지 않는다.
 *   ④ 산출만 (주기 N 선택 없음 · 자기충돌은 «매 서브스텝»)
 */
import {
  makeSolver,
  makeInplane,
  makeBend,
  assignMassFromMesh,
  dihedral,
  substepsForBending,
  substepsForCloth,
  collisionStats,
  selfStats,
  step,
  type BendConstraint,
  type Collider,
  type Constraint,
  type SelfCollisionParams,
  type Solver,
  type SolverParams,
} from '../src/v3/solver.ts';

const G = 9.81;
const DT = 1 / 60;
const KMEM = 100;
/** 시험용 원단 — ARCSim gray-interlock (v3S3.ts와 같은 값) */
const MAT = { rho: 0.187, B: 23.191698e-6 };
/** 옷 두께 [m] — S3와 «같은 값». 두 층의 분리 거리는 2× = 2 mm */
const THICK = 1e-3;
const SEP = 2 * THICK;
/** ② 허용오차 — 실행 «전»에 고정(위 헤더에 사유) */
const TOL2 = 1e-4;

const ONLY = (process.env.ONLY ?? '').split(',').filter(Boolean);
const doRun = (k: string) => ONLY.length === 0 || ONLY.includes(k);
const P = (x: number, w = 8, d = 3) => x.toFixed(d).padStart(w);

/* ── 메시 ──────────────────────────────────────────────────────────────── */
function grid(nu: number, nv: number, L: number, W: number) {
  const n = nu * nv;
  const du = L / (nu - 1);
  const dv = W / (nv - 1);
  const uv = new Float64Array(n * 2);
  const tris: number[] = [];
  for (let j = 0; j < nv; j++)
    for (let i = 0; i < nu; i++) {
      const v = j * nu + i;
      uv[v * 2] = i * du;
      uv[v * 2 + 1] = j * dv;
    }
  for (let j = 0; j < nv - 1; j++)
    for (let i = 0; i < nu - 1; i++) {
      const a = j * nu + i;
      tris.push(a, a + 1, a + nu, a + 1, a + nu + 1, a + nu);
    }
  return { n, du, dv, uv, tris };
}

/** 경계 결손 교정(v3-06) — v3S3.ts와 같은 절차 */
function bendKe(nu: number, nv: number, L: number, W: number) {
  const { n, du, uv, tris } = grid(nu, nv, L, W);
  const Leff = L - du;
  const w = MAT.rho * G;
  const yA = (x: number) =>
    x <= du
      ? 0
      : -(w / (24 * MAT.B)) *
        ((x - du) ** 4 - 4 * Leff * (x - du) ** 3 + 6 * Leff ** 2 * (x - du) ** 2);
  const kap = (x: number) => (x <= du ? 0 : (w * (Leff - (x - du)) ** 2) / (2 * MAT.B));
  const s = makeSolver(n);
  for (let v = 0; v < n; v++) {
    s.pos[v * 3] = uv[v * 2];
    s.pos[v * 3 + 1] = yA(uv[v * 2]);
    s.pos[v * 3 + 2] = uv[v * 2 + 1];
  }
  let Ed = 0;
  for (const b of makeBend(tris, uv, MAT.B)) {
    const th = dihedral(s, b);
    Ed += (MAT.B * th * th) / (2 * b.shape);
  }
  let Ec = 0;
  const M = 50000;
  for (let i = 0; i < M; i++) Ec += 0.5 * MAT.B * W * kap(((i + 0.5) * L) / M) ** 2 * (L / M);
  return MAT.B / (Ed / Ec);
}

/** 서브스텝은 «도출»한다 — 멤브레인·굽힘 둘 중 큰 쪽(r ≥ 0.95). 손 하한 없음. */
function subFor(bends: BendConstraint[], s: Solver, d: number) {
  return Math.max(
    substepsForCloth(DT, KMEM, MAT.rho, d, 0.95),
    substepsForBending(DT, s, bends, 0.95),
  );
}

/** «주름 접힌 천»을 바닥에 떨어뜨려 눌러 쌓는다.
 *
 * **정지 상태(rest)는 평면 그대로다** — `makeInplane`·`makeBend`가 쓰는 restUV는
 * 펼친 격자이고, 접힌 것은 «초기 위치»뿐이다. 접힘은 제약이 아니라 배치다.
 *
 * 볼록 충돌체만으로는 자기접촉이 «강제되지 않는다»는 것을 실측 4회가 보였다
 * (전부 DIAG 확인 · 이 판의 장면 탐색 기록):
 *  1) 무한 바닥 «하나» + 세운 커튼 — 그대로 넘어져 완전히 납작하게 누웠다
 *     (y 1.0~1.0mm · z 0~97.7mm · 접촉 대역 쌍 0). 퍼질 자리가 무한하면 접힐 이유가 없다.
 *  2) V자 깔때기«만» — 천이 V를 가로질러 매끈한 해먹으로 걸렸다(y 63~97mm · 접힘 0).
 *  3) 벽 둘 + 바닥 — 바닥엔 닿았으나(y 21.0mm) 한쪽 벽을 타고 올라가 한 겹으로 누웠다
 *     (x −47.1~8.7mm). 벽이 둘이면 남은 두 방향이 무한이다.
 *  4) 벽 넷 + 바닥(수로 30×30mm — «넓이»로는 11겹이 강제되는 배치) — 천이 원뿔로
 *     감기며 벽에 «끼어» 정지했다(y 71.2~195.4mm · |v|=0.00 · 접촉 0).
 *     볼록 깔때기는 후프 장력만으로 한 겹을 지탱한다.
 * ⟹ 볼록 반공간의 «교집합»으로는 오목한 주머니를 만들 수 없다. 그래서 겹침을
 *    배치에서 준다: 미리 주름으로 접어 놓고 중력이 눌러 쌓게 한다. 자기충돌이
 *    없으면 N개 층이 전부 바닥(y≈두께)으로 무너져 «반드시» 교차한다 — 대조군이 그것을 센다.
 *
 * **주름은 «둥글게» 접는다.** 삼각파(꺾임 180°)로 접었더니 굽힘이 폭발적으로
 * 펴지며 천이 늘어났다(실측 5: L=60mm 천의 x 폭이 대조군 133mm · 자기충돌 133→237mm).
 * 그래서 반지름 r의 «반원» 되돌림으로 잇는다: 호 길이 πr 동안 방향이 π만큼 돌고
 * 알짜 변위는 Δz=0 · Δy=2r 이므로, 곧은 구간 `straight` + 반원이 그대로
 * 「층 간격 2r · 발자국 straight」인 접힌 더미가 된다.
 *
 * 곧은 구간은 굽힘 길이 (B/ρg)^(1/3) = 23.3mm보다 «충분히» 길게 잡는다 — 짧으면
 * 굽힘 모멘트 B/r 가 중력 모멘트 w·straight²/2 를 이겨 주름이 스스로 펴진다.
 * straight=100mm에서 9.2e-3 vs 2.9e-3 N·m/m 로 중력이 3.2배다. */
/** W는 «곧은 구간 3 + 반원 2»로 도출한다 — 손 상수 금지. 임의로 0.375를 줬더니
 * 경로 꼬리가 첫 번째 반원 옆으로 감겨 들어가 «초기 상태부터» 비인접 삼각형이
 * 0.118mm까지 붙었다(sep=2mm 위반). 그 상태에서 자기충돌은 첫 서브스텝에 1.9mm를
 * 밀어야 하고, h≈1e-4 s라 위치 교정이 속도로 19 m/s가 되어 그대로 발산한다.
 * 곧은 구간에서 «끝내면» 층이 3장으로 깔끔히 쌓이고 최소 간격이 층 간격 16mm다. */
const ACC = {
  L: 0.06,
  straight: 0.1,
  layer: 0.016,
  y0: 0.005,
  get W() {
    return 3 * this.straight + 2 * Math.PI * (this.layer / 2);
  },
};
function floorCollider(): Collider[] {
  return [{ kind: 'plane', p: [0, 0, 0], n: [0, 1, 0] }];
}
function accordion(nu: number) {
  const du = ACC.L / (nu - 1);
  const nv = Math.round(ACC.W / du) + 1;
  const g = grid(nu, nv, ACC.L, ACC.W);
  const s = makeSolver(g.n);
  const ke = bendKe(nu, nv, ACC.L, ACC.W);
  // 경로를 호 길이로 적분한다: 곧은 구간 κ=0, 반원 구간 κ=1/r
  const r = ACC.layer / 2;
  const turn = Math.PI * r;
  const period = 2 * (ACC.straight + turn);
  const M = 400;
  const dt = ACC.W / (nv - 1) / M;
  const py = new Float64Array(nv);
  const pz = new Float64Array(nv);
  let yy = ACC.y0;
  let zz = 0;
  let th = 0;
  for (let j = 0; j < nv; j++) {
    py[j] = yy;
    pz[j] = zz;
    for (let m = 0; m < M; m++) {
      const sArc = (j * (nv - 1 > 0 ? ACC.W / (nv - 1) : 0) + m * dt) % period;
      // 되돌림 두 개는 «곡률 부호가 반대»여야 한다. 같은 부호로 두면 경로가
      // 코일이 되어 y가 +2r 올라갔다가 −2r 내려온다 — 실측에서 3번째 곧은
      // 구간이 1번째 위(y 4.9~5.1mm)로 정확히 겹쳐 초기 거리가 0이 됐다.
      // θ를 π→0으로 «되돌리면» Δy = +2r, Δz = 0 으로 층이 제대로 쌓인다.
      if (sArc >= ACC.straight && sArc < ACC.straight + turn) th += dt / r;
      else if (sArc >= 2 * ACC.straight + turn) th -= dt / r;
      zz += Math.cos(th) * dt;
      yy += Math.sin(th) * dt;
    }
  }
  let zMid = 0;
  for (let j = 0; j < nv; j++) zMid += pz[j] / nv;
  for (let v = 0; v < g.n; v++) {
    const j = Math.floor(v / nu);
    s.pos[v * 3] = g.uv[v * 2] - ACC.L / 2;
    s.pos[v * 3 + 1] = py[j];
    s.pos[v * 3 + 2] = pz[j] - zMid;
  }
  assignMassFromMesh(s, g.tris, g.uv, MAT.rho, new Set());
  const bends: BendConstraint[] = makeBend(g.tris, g.uv, ke);
  const con: Constraint[] = [...makeInplane(g.tris, g.uv, KMEM, KMEM, KMEM), ...bends];
  return { g, s, con, bends, sub: subFor(bends, s, Math.min(g.du, g.dv)) };
}

/* ── 교차 판정기 ───────────────────────────────────────────────────────── */
/** 선분 (s0,s1)이 삼각형 (t0,t1,t2)의 «내부»를 관통하는가 — Möller–Trumbore.
 * 공면(det≈0)은 false로 둔다: 두 삼각형이 «제대로» 교차하면 교차 구간의 양 끝점이
 * 각각 어느 한쪽 엣지 위에 있으므로 엣지 6개 중 최소 하나가 상대 내부를 관통한다
 * ⟹ 공면 겹침(측도 0)을 뺀 모든 교차가 이 6회 시험으로 잡힌다.
 *
 * u·v·t는 «열린» 구간이다. 경계를 포함하면 «맞닿기»가 교차로 잡힌다 — 자기검사
 * 6번(엣지 공유 힌지)이 그것으로 FAIL을 냈다: 한 엣지의 끝점이 상대 정점과 같아
 * t=0·u=1로 «경계 위»에 서는데 부등식이 닫혀 있어 true가 나왔다. 위 주석이
 * 처음부터 「내부를 관통」이라 적고 있었으므로 부등식을 그 정의에 맞춘다
 * (기댓값이 아니라 «구현»을 고쳤다). 대가: 관통점이 정확히 엣지·정점에 얹히는
 * 배치(측도 0)는 놓친다. */
function segTri(p: Float64Array, s0: number, s1: number, t0: number, t1: number, t2: number) {
  const dx = p[s1] - p[s0];
  const dy = p[s1 + 1] - p[s0 + 1];
  const dz = p[s1 + 2] - p[s0 + 2];
  const e1x = p[t1] - p[t0];
  const e1y = p[t1 + 1] - p[t0 + 1];
  const e1z = p[t1 + 2] - p[t0 + 2];
  const e2x = p[t2] - p[t0];
  const e2y = p[t2 + 1] - p[t0 + 1];
  const e2z = p[t2 + 2] - p[t0 + 2];
  const px = dy * e2z - dz * e2y;
  const py = dz * e2x - dx * e2z;
  const pz = dx * e2y - dy * e2x;
  const det = e1x * px + e1y * py + e1z * pz;
  if (Math.abs(det) < 1e-20) return false;
  const inv = 1 / det;
  const tx = p[s0] - p[t0];
  const ty = p[s0 + 1] - p[t0 + 1];
  const tz = p[s0 + 2] - p[t0 + 2];
  const u = (tx * px + ty * py + tz * pz) * inv;
  if (u <= 0 || u >= 1) return false;
  const qx = ty * e1z - tz * e1y;
  const qy = tz * e1x - tx * e1z;
  const qz = tx * e1y - ty * e1x;
  const v = (dx * qx + dy * qy + dz * qz) * inv;
  if (v <= 0 || u + v >= 1) return false;
  const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
  return t > 0 && t < 1;
}

function triTri(p: Float64Array, a: number[], b: number[]) {
  const A = [a[0] * 3, a[1] * 3, a[2] * 3];
  const B = [b[0] * 3, b[1] * 3, b[2] * 3];
  for (let k = 0; k < 3; k++) {
    if (segTri(p, A[k], A[(k + 1) % 3], B[0], B[1], B[2])) return true;
    if (segTri(p, B[k], B[(k + 1) % 3], A[0], A[1], A[2])) return true;
  }
  return false;
}

/** 정지 상태 자기교차 수 — 정점을 «공유하지 않는» 삼각형 쌍만 센다
 * (공유 쌍은 기하가 맞닿아 있는 것이 정상이므로 교차 판정의 대상이 아니다). */
function selfIntersections(s: Solver, tris: number[]) {
  const T = tris.length / 3;
  let cnt = 0;
  for (let i = 0; i < T; i++)
    for (let j = i + 1; j < T; j++) {
      const a = [tris[i * 3], tris[i * 3 + 1], tris[i * 3 + 2]];
      const b = [tris[j * 3], tris[j * 3 + 1], tris[j * 3 + 2]];
      if (a.some((v) => b.includes(v))) continue;
      if (triTri(s.pos, a, b)) cnt++;
    }
  return cnt;
}

/* ── 최소 거리(② 계기) — 하네스는 솔버의 닫힌 형식을 «재사용하지 않는다» ── */
function ptTri(p: Float64Array, o: number, a: number, b: number, c: number) {
  const ax = p[a];
  const ay = p[a + 1];
  const az = p[a + 2];
  const abx = p[b] - ax;
  const aby = p[b + 1] - ay;
  const abz = p[b + 2] - az;
  const acx = p[c] - ax;
  const acy = p[c + 1] - ay;
  const acz = p[c + 2] - az;
  const apx = p[o] - ax;
  const apy = p[o + 1] - ay;
  const apz = p[o + 2] - az;
  const d00 = abx * abx + aby * aby + abz * abz;
  const d01 = abx * acx + aby * acy + abz * acz;
  const d11 = acx * acx + acy * acy + acz * acz;
  const d20 = apx * abx + apy * aby + apz * abz;
  const d21 = apx * acx + apy * acy + apz * acz;
  const den = d00 * d11 - d01 * d01;
  let best = Infinity;
  // 내부에 투영되면 그 거리, 아니면 세 엣지의 최소
  if (Math.abs(den) > 1e-24) {
    const v = (d11 * d20 - d01 * d21) / den;
    const w = (d00 * d21 - d01 * d20) / den;
    if (v >= 0 && w >= 0 && v + w <= 1)
      best = Math.hypot(
        ax + abx * v + acx * w - p[o],
        ay + aby * v + acy * w - p[o + 1],
        az + abz * v + acz * w - p[o + 2],
      );
  }
  for (const [e0, e1] of [
    [a, b],
    [b, c],
    [c, a],
  ]) {
    const ex = p[e1] - p[e0];
    const ey = p[e1 + 1] - p[e0 + 1];
    const ez = p[e1 + 2] - p[e0 + 2];
    const ll = ex * ex + ey * ey + ez * ez;
    let t =
      ll > 1e-24
        ? ((p[o] - p[e0]) * ex + (p[o + 1] - p[e0 + 1]) * ey + (p[o + 2] - p[e0 + 2]) * ez) / ll
        : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const d = Math.hypot(
      p[e0] + t * ex - p[o],
      p[e0 + 1] + t * ey - p[o + 1],
      p[e0 + 2] + t * ez - p[o + 2],
    );
    if (d < best) best = d;
  }
  return best;
}

/** 두 선분 최소 거리 — 조밀 표본 + 국소 세분 4회(독립 구현).
 * 21×21 격자를 4회 좁히면 엣지 10 mm에서 분해능 ≈ 6 µm로, ② 허용오차 100 µm의
 * 1/16이다. 솔버와 «같은» 닫힌 형식을 쓰면 같은 실수를 두 번 하게 된다. */
function segSeg(p: Float64Array, a: number, b: number, c: number, d: number) {
  let bs = 0.5;
  let bt = 0.5;
  let best = Infinity;
  let half = 0.5;
  for (let pass = 0; pass < 4; pass++) {
    const s0 = Math.max(0, bs - half);
    const s1 = Math.min(1, bs + half);
    const t0 = Math.max(0, bt - half);
    const t1 = Math.min(1, bt + half);
    const hs = (s1 - s0) / 20;
    const ht = (t1 - t0) / 20;
    best = Infinity;
    let ns = bs;
    let nt = bt;
    for (let i = 0; i <= 20; i++)
      for (let j = 0; j <= 20; j++) {
        const sv = s0 + hs * i;
        const tv = t0 + ht * j;
        const dd = Math.hypot(
          p[a] + sv * (p[b] - p[a]) - (p[c] + tv * (p[d] - p[c])),
          p[a + 1] + sv * (p[b + 1] - p[a + 1]) - (p[c + 1] + tv * (p[d + 1] - p[c + 1])),
          p[a + 2] + sv * (p[b + 2] - p[a + 2]) - (p[c + 2] + tv * (p[d + 2] - p[c + 2])),
        );
        if (dd < best) {
          best = dd;
          ns = sv;
          nt = tv;
        }
      }
    bs = ns;
    bt = nt;
    half = Math.max(hs, ht);
  }
  return best;
}

/** 비인접 삼각형 쌍의 최소 거리 — AABB 간극이 window 안인 쌍만 정밀 계산한다.
 * ②와 «초기 상태 적법성» 검사가 같은 계기를 쓴다(정의역이 갈리지 않게). */
function minPairDist(pos: Float64Array, tris: number[], window: number) {
  const T = tris.length / 3;
  const box = new Float64Array(T * 6);
  for (let t = 0; t < T; t++)
    for (let k = 0; k < 3; k++) {
      const o = [tris[t * 3] * 3, tris[t * 3 + 1] * 3, tris[t * 3 + 2] * 3];
      box[t * 6 + k] = Math.min(pos[o[0] + k], pos[o[1] + k], pos[o[2] + k]);
      box[t * 6 + 3 + k] = Math.max(pos[o[0] + k], pos[o[1] + k], pos[o[2] + k]);
    }
  let min = Infinity;
  let near = 0;
  let viol = 0;
  const worst = [-1, -1];
  for (let i = 0; i < T; i++)
    for (let j = i + 1; j < T; j++) {
      const a = [tris[i * 3], tris[i * 3 + 1], tris[i * 3 + 2]];
      const b = [tris[j * 3], tris[j * 3 + 1], tris[j * 3 + 2]];
      if (a.some((v) => b.includes(v))) continue;
      let gap = 0;
      for (let k = 0; k < 3; k++)
        gap = Math.max(gap, box[i * 6 + k] - box[j * 6 + 3 + k], box[j * 6 + k] - box[i * 6 + 3 + k]);
      if (gap > window) continue;
      const d = triTriDist(pos, a, b);
      if (d < window) near++;
      if (d < SEP - TOL2) viol++;
      if (d < min) {
        min = d;
        worst[0] = i;
        worst[1] = j;
      }
    }
  return { min, near, viol, worst };
}

function triTriDist(p: Float64Array, a: number[], b: number[]) {
  const A = [a[0] * 3, a[1] * 3, a[2] * 3];
  const B = [b[0] * 3, b[1] * 3, b[2] * 3];
  let m = Infinity;
  for (let k = 0; k < 3; k++) {
    m = Math.min(m, ptTri(p, A[k], B[0], B[1], B[2]));
    m = Math.min(m, ptTri(p, B[k], A[0], A[1], A[2]));
  }
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      m = Math.min(m, segSeg(p, A[i], A[(i + 1) % 3], B[j], B[(j + 1) % 3]));
  return m;
}

/* ── 실행기 ────────────────────────────────────────────────────────────── */
function run(
  s: Solver,
  con: Constraint[],
  sub: number,
  secs: number,
  damping: number,
  self?: SelfCollisionParams,
  col?: SolverParams['collision'],
  bucketFrames = 0,
) {
  collisionStats.fill(0);
  selfStats.fill(0);
  const p: SolverParams = {
    dt: DT,
    substeps: sub,
    gravity: G,
    damping,
    collision: col,
    selfCollision: self,
  };
  const frames = Math.round(secs / DT);
  const buckets: number[] = [];
  const t0 = performance.now();
  let mark = t0;
  for (let f = 0; f < frames; f++) {
    step(s, con, p);
    if (bucketFrames && (f + 1) % bucketFrames === 0) {
      const now = performance.now();
      buckets.push(now - mark);
      mark = now;
    }
  }
  return { ms: performance.now() - t0, buckets };
}

console.log(`[v3-12] S3b 자기충돌 — 정점–삼각형 + 엣지–엣지 · **흡착·인력 항 0**`);
console.log(
  `[설계] 두께=${THICK * 1000}mm(S3와 동일) · 분리거리=2×두께=${SEP * 1000}mm · 인접제외=정점 공유(0링) · 자기접촉 마찰 «미적용»`,
);
console.log(
  `[설계] 광역 셀 = mean(엣지) + 2×두께 (확장 AABB 전형 폭 — 손 상수 0) · 자기충돌은 «매 서브스텝»(주기 N 선택 없음)`,
);
console.log(
  `[문턱] G 자기검사 6/6 · ① 교차 0(off 대조군 >0) · ② 최소거리 ≥ ${SEP * 1000}−${TOL2 * 1000}mm · ④ 산출만 (사전 등록 · 무조정)`,
);

/* ── G 교차 판정기 자기검사 ────────────────────────────────────────────── */
let okG = true;
if (doRun('G')) {
  console.log(`\nG 교차 판정기 자기검사 — 인위 배치 6종. 실패하면 ①을 «판정하지 않는다»`);
  const cases: [string, number[], boolean][] = [
    [
      'A의 엣지가 B 내부를 관통',
      [0, -0.02, 0, 0, 0.02, 0, 0.005, 0, 0.01, -0.05, 0, -0.05, 0.05, 0, -0.05, 0, 0, 0.05],
      true,
    ],
    [
      'B의 엣지가 A 내부를 관통(반대 방향)',
      [-0.05, 0, -0.05, 0.05, 0, -0.05, 0, 0, 0.05, 0, -0.02, 0, 0, 0.02, 0, 0.005, 0, 0.01],
      true,
    ],
    [
      '평행 두 층 5mm 간격',
      [0, 0, 0, 0.05, 0, 0, 0, 0, 0.05, 0, 0.005, 0, 0.05, 0.005, 0, 0, 0.005, 0.05],
      false,
    ],
    [
      '거의 닿음 0.1mm(오검출 시험)',
      [0, 0, 0, 0.05, 0, 0, 0, 0, 0.05, 0, 1e-4, 0, 0.05, 1e-4, 0, 0, 1e-4, 0.05],
      false,
    ],
    [
      '공면 · 서로 떨어짐',
      [0, 0, 0, 0.02, 0, 0, 0, 0, 0.02, 0.1, 0, 0, 0.12, 0, 0, 0.1, 0, 0.02],
      false,
    ],
    [
      '엣지 공유(힌지) — 제대로 교차하지 않는다',
      [0, 0, 0, 0.02, 0, 0, 0, 0, 0.02, 0, 0, 0, 0.02, 0, 0, 0, 0.01, -0.017],
      false,
    ],
  ];
  for (const [name, coords, want] of cases) {
    const p = new Float64Array(coords);
    const got = triTri(p, [0, 1, 2], [3, 4, 5]);
    const pass = got === want;
    okG &&= pass;
    console.log(
      `   ${name.padEnd(34)} 기대 ${String(want).padEnd(5)} 실측 ${String(got).padEnd(5)} ${pass ? 'PASS' : 'FAIL'}`,
    );
  }
  console.log(`   ⟹ G ${okG ? 'PASS (판정기 신뢰 가능)' : 'FAIL — 갈래 G · ①을 판정하지 않는다'}`);
}

/* ── ① 자기관통 0 ──────────────────────────────────────────────────────── */
const NU = Number(process.env.NU ?? 7);
const TSEC = Number(process.env.T ?? 1.5);
/** y0·tan25° = 74.6mm > L/2 = 50mm ⟹ 초기 관통 0 */
const BODY = { colliders: floorCollider(), thickness: THICK, mu: 0.3 };

if (doRun('1')) {
  console.log(`\n① 자기관통 0 — 주름 접힌 천을 바닥에 떨어뜨려 눌러 쌓는다 (T=${TSEC}s)`);
  console.log(
    `   ${'자기충돌'.padStart(10)}${'정점'.padStart(6)}${'삼각형'.padStart(7)}${'sub'.padStart(6)}${'교차'.padStart(7)}${'근접쌍'.padStart(11)}${'접촉'.padStart(11)}${'최대침투[mm]'.padStart(14)}${'총ms'.padStart(9)}`,
  );
  // 초기 상태 적법성 — 시작부터 sep을 어기면 자기충돌이 첫 서브스텝에 큰 교정을
  // 넣고 h≈1e-4s가 그것을 속도로 1e4배 증폭한다. 실제로 그렇게 발산했다(초기
  // 0.118mm). 장면이 적법한지 «먼저» 값으로 확인하고, 아니면 ①을 판정하지 않는다.
  {
    const c0 = accordion(NU);
    if (process.env.DIAG === '1') {
      const nvv = c0.s.n / NU;
      const rows: string[] = [];
      for (let j = 0; j < nvv; j++)
        rows.push(
          `${j}:(${(c0.s.pos[j * NU * 3 + 1] * 1000).toFixed(1)},${(c0.s.pos[j * NU * 3 + 2] * 1000).toFixed(1)})`,
        );
      console.log(`      [DIAG] 경로 행 (y,z)mm · nv=${nvv}\n        ${rows.join(' ')}`);
    }
    const m0 = minPairDist(c0.s.pos, c0.g.tris, 2 * SEP);
    const legal = !(m0.min < SEP);
    console.log(
      `   [초기] 비인접 최소 거리 ${P(m0.min * 1000, 8, 4)} mm (sep ${SEP * 1000}mm · 최근접 쌍 ${m0.worst[0]},${m0.worst[1]}) ⟹ ${legal ? '적법' : '위법 — 장면 무효'}`,
    );
    if (!legal) {
      console.log(`   ⟹ ① 판정 불가 — 초기 상태가 이미 sep을 어긴다`);
      process.exitCode = 1;
    }
  }
  const xs: Record<string, number> = {};
  let onScene: ReturnType<typeof accordion> | undefined;
  for (const on of [false, true]) {
    const c = accordion(NU);
    const self = on ? { tris: c.g.tris, thickness: THICK } : undefined;
    const r = run(c.s, c.con, c.sub, TSEC, 6, self, BODY);
    const x = selfIntersections(c.s, c.g.tris);
    xs[on ? 'on' : 'off'] = x;
    if (on) onScene = c;
    if (process.env.DIAG === '1') {
      // 장면 진단 — «구겨 쌓였는가»를 값으로 본다. 납작하면 시험이 성립하지 않는다.
      const lo = [Infinity, Infinity, Infinity];
      const hi = [-Infinity, -Infinity, -Infinity];
      for (let v = 0; v < c.s.n; v++)
        for (let k = 0; k < 3; k++) {
          lo[k] = Math.min(lo[k], c.s.pos[v * 3 + k]);
          hi[k] = Math.max(hi[k], c.s.pos[v * 3 + k]);
        }
      let vmax = 0;
      for (let v = 0; v < c.s.n; v++)
        vmax = Math.max(vmax, Math.hypot(c.s.vel[v * 3], c.s.vel[v * 3 + 1], c.s.vel[v * 3 + 2]));
      // 엣지 신장 최대 — 장면이 «불안정»한지 값으로 가른다(늘어나면 장면이 무효다)
      let smax = 0;
      const tr = c.g.tris;
      for (let t = 0; t < tr.length; t += 3)
        for (let k = 0; k < 3; k++) {
          const a = tr[t + k];
          const b = tr[t + ((k + 1) % 3)];
          const rest = Math.hypot(
            c.g.uv[b * 2] - c.g.uv[a * 2],
            c.g.uv[b * 2 + 1] - c.g.uv[a * 2 + 1],
          );
          const cur = Math.hypot(
            c.s.pos[b * 3] - c.s.pos[a * 3],
            c.s.pos[b * 3 + 1] - c.s.pos[a * 3 + 1],
            c.s.pos[b * 3 + 2] - c.s.pos[a * 3 + 2],
          );
          smax = Math.max(smax, cur / rest);
        }
      console.log(
        `      [DIAG] AABB x ${P(lo[0] * 1000, 7, 1)}~${P(hi[0] * 1000, 6, 1)} · y ${P(lo[1] * 1000, 7, 1)}~${P(hi[1] * 1000, 6, 1)} · z ${P(lo[2] * 1000, 7, 1)}~${P(hi[2] * 1000, 6, 1)} mm · |v|max ${P(vmax * 1000, 8, 2)} mm/s · 엣지신장max ${P(smax, 6, 3)}`,
      );
    }
    console.log(
      `   ${(on ? 'ON' : 'OFF(대조)').padStart(10)}${String(c.s.n).padStart(6)}${String(c.g.tris.length / 3).padStart(7)}${String(c.sub).padStart(6)}` +
        `${String(x).padStart(7)}${selfStats[0].toExponential(2).padStart(11)}${selfStats[1].toExponential(2).padStart(11)}` +
        `${P(selfStats[2] * 1000, 14, 4)}${P(r.ms, 9, 0)}`,
    );
  }
  const ok1 = xs.on === 0 && xs.off > 0;
  console.log(
    `   ⟹ ① ${ok1 ? 'PASS' : 'FAIL'} (ON 교차 ${xs.on} · OFF 대조군 교차 ${xs.off} — 대조군이 0이면 장면이 자기충돌을 «시험하지 못한 것»이다)`,
  );

  /* ── ② 두께 유지 ─────────────────────────────────────────────────────── */
  if (doRun('2') && onScene) {
    console.log(`\n② 두께 유지 — 비인접 삼각형 쌍의 최소 거리 ≥ ${SEP * 1000} − ${TOL2 * 1000} mm`);
    const c = onScene;
    const m = minPairDist(c.s.pos, c.g.tris, 2 * SEP);
    const viol = m.viol;
    console.log(
      `   접촉 대역 쌍(거리 < ${2 * SEP * 1000}mm) ${m.near}  ·  최소 거리 ${P(m.min * 1000, 8, 4)} mm (쌍 ${m.worst})  ·  위반 쌍 ${viol}`,
    );
    console.log(`   ⟹ ② ${viol === 0 ? 'PASS' : 'FAIL'} (문턱 ${((SEP - TOL2) * 1000).toFixed(1)} mm)`);
  }
}

/* ── ⑤ 미지정 호출이 자기충돌 코드를 «한 줄도» 안 밟는지 값으로 확인 ────── */
if (doRun('5')) {
  console.log(`\n⑤ 가드 — selfCollision 미지정이면 자기충돌 코드가 «한 줄도» 돌지 않아야 한다`);
  const a = accordion(NU);
  run(a.s, a.con, a.sub, 0.2, 6, undefined, BODY);
  const zero = Array.from(selfStats).every((v) => v === 0);
  // 같은 장면을 «두 번» 돌려 위치가 비트 동일한지도 본다(결정성 · 잔여 상태 0)
  const b = accordion(NU);
  run(b.s, b.con, b.sub, 0.2, 6, undefined, BODY);
  let same = a.s.pos.length === b.s.pos.length;
  for (let i = 0; same && i < a.s.pos.length; i++) same = a.s.pos[i] === b.s.pos[i];
  console.log(
    // 칸 수는 «배열에서» 뜬다 — 손으로 적으면 계기 이름과 정의역이 어긋난다(함정 13).
    // 실제로 8로 적혀 있었고 배열은 7칸이었다(판정 자체는 배열 전량을 봤으므로 무영향).
    `   selfStats ${selfStats.length}칸 전부 0 = ${zero}  ·  두 번 실행 위치 비트 동일 = ${same}  ⟹ ${zero && same ? 'PASS' : 'FAIL'}`,
  );
  console.log(`   selfStats = [${Array.from(selfStats).join(', ')}]`);
  if (!(zero && same)) process.exitCode = 1;
}

/* ── ④a 비용: 자기충돌 있음/없음 × 정점 수 ─────────────────────────────── */
if (doRun('4a')) {
  const TC = Number(process.env.TC ?? 0.3);
  console.log(`\n④a 비용 — 자기충돌 on/off × 정점 수. T=${TC}s · 자기충돌은 «매 서브스텝»`);
  console.log(
    `   ${'정점'.padStart(6)}${'삼각형'.padStart(7)}${'sub'.padStart(6)}${'off총ms'.padStart(10)}${'on총ms'.padStart(10)}${'배수'.padStart(7)}` +
      `${'광역ms'.padStart(9)}${'협역ms'.padStart(9)}${'해소ms'.padStart(9)}${'자기총ms'.padStart(10)}${'근접쌍'.padStart(11)}`,
  );
  for (const nu of [9, 11, 13]) {
    const a = accordion(nu);
    const rOff = run(a.s, a.con, a.sub, TC, 6, undefined, BODY);
    const offMs = rOff.ms;
    const b = accordion(nu);
    const rOn = run(b.s, b.con, b.sub, TC, 6, { tris: b.g.tris, thickness: THICK }, BODY);
    console.log(
      `   ${String(b.s.n).padStart(6)}${String(b.g.tris.length / 3).padStart(7)}${String(b.sub).padStart(6)}` +
        `${P(offMs, 10, 0)}${P(rOn.ms, 10, 0)}${P(rOn.ms / offMs, 7, 2)}` +
        `${P(selfStats[3], 9, 0)}${P(selfStats[4], 9, 0)}${P(selfStats[5], 9, 0)}${P(selfStats[6], 10, 0)}${selfStats[0].toExponential(2).padStart(11)}`,
    );
  }
}

/* ── ④b #24 후보 ① — T를 늘려 구간별 ms가 평탄한지 ─────────────────────── */
if (doRun('4b')) {
  const T24 = Number(process.env.T24 ?? 5);
  const EVERY = (process.env.EVERY ?? '1,4,16').split(',').map(Number);
  console.log(
    `\n④b #24 후보 ①(1.5초 이후 전이) — v3-11과 «같은» 구 낙하 장면을 T=${T24}s로 늘린다 (자기충돌 off)`,
  );
  console.log(`   구간 = 30프레임(0.5s)마다 벽시계 ms. v3-11은 T=1.5s에서 평탄했다`);
  const R = 0.05;
  const sphere: Collider = { kind: 'sphere', c: [0, 0, 0], r: R };
  const sheetFall = (nu: number) => {
    const g = grid(nu, nu, 0.12, 0.12);
    const s = makeSolver(g.n);
    const ke = bendKe(nu, nu, 0.12, 0.12);
    for (let v = 0; v < g.n; v++) {
      s.pos[v * 3] = g.uv[v * 2 + 1] - 0.06;
      s.pos[v * 3 + 1] = R + 0.02;
      s.pos[v * 3 + 2] = g.uv[v * 2] - 0.06;
    }
    assignMassFromMesh(s, g.tris, g.uv, MAT.rho, new Set());
    const bends = makeBend(g.tris, g.uv, ke);
    const con: Constraint[] = [...makeInplane(g.tris, g.uv, KMEM, KMEM, KMEM), ...bends];
    return { g, s, con, sub: Math.max(1024, substepsForBending(DT, s, bends, 0.95)) };
  };
  for (const every of EVERY) {
    const f = sheetFall(25);
    const r = run(
      f.s,
      f.con,
      f.sub,
      T24,
      6,
      undefined,
      { colliders: [sphere], thickness: THICK, mu: 0.3, every },
      30,
    );
    console.log(
      `   every ${String(every).padStart(2)} : sub=${f.sub} · 총 ${P(r.ms, 9, 0)} ms · ${P(r.ms / T24 / 1000, 6, 1)} s/시뮬초 · 구간 ` +
        r.buckets.map((b) => b.toFixed(0).padStart(6)).join(' '),
    );
  }
}
