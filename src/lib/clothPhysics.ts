import * as THREE from "three";

export interface ClothCollider {
  position: THREE.Vector3;
  radius: number;
}

// 충돌 처리를 구체/메시 등 특정 형태에 묶어두지 않기 위한 콜백 형태.
// positions/pinned 배열을 직접 in-place로 수정한다.
export type CollisionResolver = (positions: Float32Array, pinned: Uint8Array, particleCount: number) => void;

// 여러 CollisionResolver를 순서대로 적용하는 하나의 resolver로 합친다
// (예: 마네킹 메시 충돌 + 옷감 자체 충돌).
export function combineResolvers(...resolvers: CollisionResolver[]): CollisionResolver {
  return (positions, pinned, n) => {
    for (const resolve of resolvers) resolve(positions, pinned, n);
  };
}

// 구체 콜라이더 배열을 CollisionResolver로 변환하는 헬퍼. 메시 충돌 준비 전
// 임시 대체용이나 간단한 테스트용으로 계속 쓸 수 있게 남겨둔다.
export function sphereCollisionResolver(colliders: readonly ClothCollider[]): CollisionResolver {
  return (positions, pinned, n) => {
    for (let i = 0; i < n; i++) {
      if (pinned[i]) continue;
      const ix = i * 3;
      for (const col of colliders) {
        const dx = positions[ix] - col.position.x;
        const dy = positions[ix + 1] - col.position.y;
        const dz = positions[ix + 2] - col.position.z;
        const distSq = dx * dx + dy * dy + dz * dz;
        const r = col.radius;
        if (distSq < r * r) {
          const dist = Math.sqrt(distSq) || 1e-6;
          positions[ix] = col.position.x + (dx / dist) * r;
          positions[ix + 1] = col.position.y + (dy / dist) * r;
          positions[ix + 2] = col.position.z + (dz / dist) * r;
        }
      }
    }
  };
}

interface Constraint {
  a: number;
  b: number;
  restLength: number;
}

export interface PanelDims {
  cols: number;
  rows: number;
}

// 30번(진짜 물리적 병합): 예전엔 모든 패널이 같은 cols x rows 격자여야 했다
// (몸판 2패널 vs 소매 2패널이 서로 다른 그리드 크기라 하나의 인스턴스로
// 못 합치고 별개 ClothSimulation 두 개 + 매 프레임 근사 스티칭으로 이어붙일
// 수밖에 없었던 근본 이유 — garmentStitch.ts 주석 참고). 패널마다 자기만의
// cols/rows를 갖도록(PanelDims 배열) 일반화해서, 몸판(앞/뒤판)과 소매(좌/우)
// 를 진짜 하나의 파티클 배열·하나의 제약 조건 집합으로 합칠 수 있게 한다.
// index()는 각 패널의 시작 오프셋(panelOffsets)만 미리 계산해두면 이전과
// 똑같은 방식으로 동작해, 이 클래스를 쓰는 코드 대부분(index()만 쓰는 코드)은
// 안 바뀐다 — 격자 크기를 직접 참조하던 몇몇 메서드(buildConstraints,
// preserveColumnOrder/RowOrder, smoothColumns/Rows)만 패널별 cols/rows를
// 쓰도록, 그리고 특정 패널 구간에만 적용하도록(fromPanel/toPanelExclusive)
// 고쳤다 — 소매처럼 이 안전장치들이 애초에 안 쓰이던 패널까지 실수로
// 건드리지 않기 위해서다.
export class ClothSimulation {
  readonly panelDims: readonly PanelDims[];
  readonly panels: number;
  private readonly panelOffsets: number[];
  positions: Float32Array;
  prevPositions: Float32Array;
  pinned: Uint8Array;
  private constraints: Constraint[] = [];
  // step() 시작 시점 위치를 담아두는 스크래치 버퍼 — displacement clamping이
  // "이번 서브스텝 동안 얼마나 움직였는지"를 비교할 기준점으로 쓴다. 매
  // step() 호출마다 새로 할당하면 60fps 워커에서 GC 압박이 생기므로 한 번만
  // 만들어 재사용한다.
  private startPositions: Float32Array;

  constructor(panelDims: readonly PanelDims[]) {
    this.panelDims = panelDims;
    this.panels = panelDims.length;
    this.panelOffsets = [];
    let offset = 0;
    for (const d of panelDims) {
      this.panelOffsets.push(offset);
      offset += d.cols * d.rows;
    }
    const n = offset;
    this.positions = new Float32Array(n * 3);
    this.prevPositions = new Float32Array(n * 3);
    this.pinned = new Uint8Array(n);
    this.startPositions = new Float32Array(n * 3);
  }

  index(panel: number, x: number, y: number): number {
    return this.panelOffsets[panel] + y * this.panelDims[panel].cols + x;
  }

  // panel이 시작하는 파티클 인덱스(포함) — 예: panelParticleStart(2)는
  // 0/1번 패널(몸판 앞+뒤)이 차지하는 파티클 수와 같아서, "몸판 범위만"
  // 슬라이싱(자체충돌 등)하는 데 쓴다.
  panelParticleStart(panel: number): number {
    return this.panelOffsets[panel];
  }

  panelParticleCount(panel: number): number {
    const d = this.panelDims[panel];
    return d.cols * d.rows;
  }

  setParticle(i: number, x: number, y: number, z: number): void {
    const ix = i * 3;
    this.positions[ix] = x;
    this.positions[ix + 1] = y;
    this.positions[ix + 2] = z;
    this.prevPositions[ix] = x;
    this.prevPositions[ix + 1] = y;
    this.prevPositions[ix + 2] = z;
  }

  pin(i: number, x: number, y: number, z: number): void {
    this.pinned[i] = 1;
    this.setParticle(i, x, y, z);
  }

  // 현재 배치된 위치를 기준으로 각 패널 내부의 구조/전단/벤드 제약을 만든다.
  // 옷 크기가 바뀌어 그리드를 다시 배치할 때마다 다시 호출해야 한다. 패널 간
  // 연결(시접)은 별도로 addConstraint()를 호출해 추가한다.
  buildConstraints(): void {
    this.constraints = [];
    const add = (a: number, b: number) => {
      const ax = this.positions[a * 3];
      const ay = this.positions[a * 3 + 1];
      const az = this.positions[a * 3 + 2];
      const bx = this.positions[b * 3];
      const by = this.positions[b * 3 + 1];
      const bz = this.positions[b * 3 + 2];
      const restLength = Math.hypot(bx - ax, by - ay, bz - az);
      this.constraints.push({ a, b, restLength });
    };
    for (let p = 0; p < this.panels; p++) {
      const { cols, rows } = this.panelDims[p];
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const i = this.index(p, x, y);
          if (x < cols - 1) add(i, this.index(p, x + 1, y)); // structural
          if (y < rows - 1) add(i, this.index(p, x, y + 1)); // structural
          if (x < cols - 1 && y < rows - 1) {
            add(i, this.index(p, x + 1, y + 1)); // shear
            add(this.index(p, x + 1, y), this.index(p, x, y + 1)); // shear
          }
          if (x < cols - 2) add(i, this.index(p, x + 2, y)); // bend
          if (y < rows - 2) add(i, this.index(p, x, y + 2)); // bend
        }
      }
    }
  }

  // 격자 위상과 무관한 임의의 제약(패널 간 시접 등)을 추가한다. buildConstraints()
  // 호출 이후에 호출해야 한다(그렇지 않으면 buildConstraints가 초기화해버린다).
  addConstraint(a: number, b: number, restLength: number): void {
    this.constraints.push({ a, b, restLength });
  }

  // collisionEvery: 충돌 검사는 비용이 커서(특히 메시 BVH 기반) 매 반복마다
  // 하지 않고 N번째 반복마다 한 번씩만 수행한다. 마지막 반복에는 항상 수행해
  // 최종 결과가 뚫고 지나가지 않게 한다.
  //
  // everyIterationExtra: collisionEvery로 스로틀링되지 않고 매 반복마다
  // 무조건 도는 별도 훅(예: preserveColumnOrder). O(cols*rows) 수준으로
  // 값싼 순서 보존/안전장치는 비싼 메시 충돌과 같은 주기로 스로틀링하면
  // 그 사이 반복들에서 구조 제약이 순서를 뒤집을 기회를 열어주게 되어
  // 원래 목적(역전이 애초에 누적되지 않게)을 잃는다(실측으로 재현 — BVH
  // 아키텍처로 되돌아오며 이 훅을 resolveCollisions에 합쳐 넣었다가
  // collisionEvery=3에 묻혀 같은 증상이 재발했었다).
  step(
    dt: number,
    gravity: THREE.Vector3,
    resolveCollisions: CollisionResolver,
    iterations: number,
    collisionEvery = 1,
    damping = 0.99,
    maxDisplacement = Infinity,
    everyIterationExtra?: CollisionResolver,
  ): void {
    const n = this.positions.length / 3;
    const dt2 = dt * dt;
    this.startPositions.set(this.positions);

    for (let i = 0; i < n; i++) {
      if (this.pinned[i]) continue;
      const ix = i * 3;
      for (let k = 0; k < 3; k++) {
        const cur = this.positions[ix + k];
        const prev = this.prevPositions[ix + k];
        const g = k === 0 ? gravity.x : k === 1 ? gravity.y : gravity.z;
        const next = cur + (cur - prev) * damping + g * dt2;
        this.prevPositions[ix + k] = cur;
        this.positions[ix + k] = next;
      }
    }

    // Gauss-Seidel 방식(매 제약이 "방금 갱신된" 이웃 값을 바로 다음 계산에
    // 씀)은 제약을 항상 같은 순서(왼쪽→오른쪽으로 만들어진 constraints
    // 배열 순서)로 훑으면 그 훑는 방향으로 구조적인 편향이 생긴다 — 몸
    // 실측/핀이 완벽히 좌우 대칭이어도 옷이 한쪽으로 미세하게 기울어지는
    // 원인이었다(실측으로 확인: 핀·충돌 메시 전부 대칭인데도 밑단이 한쪽만
    // 짧아짐). 반복마다 훑는 방향을 번갈아(정방향/역방향) 바꿔 이 편향을
    // 상쇄시킨다 — 표준적인 완화 기법이다.
    const constraintCount = this.constraints.length;
    for (let iter = 0; iter < iterations; iter++) {
      const forward = iter % 2 === 0;
      for (let ci = 0; ci < constraintCount; ci++) {
        const c = this.constraints[forward ? ci : constraintCount - 1 - ci];
        const ai = c.a * 3;
        const bi = c.b * 3;
        const pinnedA = this.pinned[c.a];
        const pinnedB = this.pinned[c.b];
        if (pinnedA && pinnedB) continue;

        const dx = this.positions[bi] - this.positions[ai];
        const dy = this.positions[bi + 1] - this.positions[ai + 1];
        const dz = this.positions[bi + 2] - this.positions[ai + 2];
        const dist = Math.hypot(dx, dy, dz) || 1e-6;
        const diff = (dist - c.restLength) / dist;

        const moveA = pinnedA ? 0 : pinnedB ? 1 : 0.5;
        const moveB = pinnedB ? 0 : pinnedA ? 1 : 0.5;

        if (!pinnedA) {
          this.positions[ai] += dx * diff * moveA;
          this.positions[ai + 1] += dy * diff * moveA;
          this.positions[ai + 2] += dz * diff * moveA;
        }
        if (!pinnedB) {
          this.positions[bi] -= dx * diff * moveB;
          this.positions[bi + 1] -= dy * diff * moveB;
          this.positions[bi + 2] -= dz * diff * moveB;
        }
      }

      if (iter % collisionEvery === 0 || iter === iterations - 1) {
        resolveCollisions(this.positions, this.pinned, n);
      }
      everyIterationExtra?.(this.positions, this.pinned, n);
    }

    // Displacement clamping: 절단면(암홀) 근처의 충돌 노멀이 튀거나 제약들이
    // 서로 힘겨루기를 하면, 파티클 하나가 한 서브스텝 만에 정상 범위를 크게
    // 벗어나 "순간이동"하듯 튀어 찢어진 것처럼 보일 수 있다. 이번 서브스텝
    // 시작 위치 대비 이동 거리가 maxDisplacement를 넘으면 그 방향은 유지한
    // 채 길이만 잘라내(clamp), 어떤 소스(중력/제약/충돌)에서 온 스파이크든
    // 한 프레임에 화면 밖으로 튀는 것을 막는다.
    if (maxDisplacement < Infinity) {
      const maxSq = maxDisplacement * maxDisplacement;
      for (let i = 0; i < n; i++) {
        if (this.pinned[i]) continue;
        const ix = i * 3;
        const dx = this.positions[ix] - this.startPositions[ix];
        const dy = this.positions[ix + 1] - this.startPositions[ix + 1];
        const dz = this.positions[ix + 2] - this.startPositions[ix + 2];
        const distSq = dx * dx + dy * dy + dz * dz;
        if (distSq <= maxSq) continue;
        const scale = maxDisplacement / Math.sqrt(distSq);
        this.positions[ix] = this.startPositions[ix] + dx * scale;
        this.positions[ix + 1] = this.startPositions[ix + 1] + dy * scale;
        this.positions[ix + 2] = this.startPositions[ix + 2] + dz * scale;
      }
    }
  }

  // 안전장치: 충돌 처리(특히 자체충돌)가 아직 구조적으로 안정되지 않은 상태를
  // 밀어내다 보면, 드물게 파티클 하나가 제 이웃에서 크게 벗어나 뾰족하게
  // 튀어나온 삼각형(찢어진 것처럼 보이는 렌더링 아티팩트)을 만들 수 있다.
  // 원인이 정확히 무엇이든, 어떤 제약도 원래 길이의 일정 배수 이상으로
  // 늘어나지 않도록 강제로 되돌려 그 가능성 자체를 없앤다(strain limiting,
  // 프로덕션 천 시뮬레이터에서 흔히 쓰는 기법). step() 내부가 아니라 호출
  // 측(자체충돌 등 step() 이후에 위치를 건드리는 로직까지 전부 끝난 뒤)에서
  // 명시적으로 호출해야, 가장 나중에 개입한 로직이 만든 왜곡까지 놓치지
  // 않고 잡아낸다. 한 번의 보정이 이웃 제약을 다시 어기게 만들 수 있어
  // 여러 번 통과시켜야 더 확실히 수렴한다.
  clampOverstretchedConstraints(passes = 2): void {
    for (let p = 0; p < passes; p++) this.limitStrain();
  }

  // 자체충돌을 꺼둔 상태(성능 우선)에서, 어깨 핀(좁음)에서 몸통 전체 폭
  // (넓음)으로 몇 행 만에 확 벌어지는 테이퍼 구간은 중력만으로도 안쪽으로
  // 무너지려는 경향이 있다 — 그 과정에서 같은 행의 인접한 두 열이 서로를
  // 추월해 자리를 바꿔버리는("순서 역전") 현상이 실측으로 확인됐다(충돌을
  // 완전히 꺼도 재현되므로 충돌과 무관한 순수 구조/중력 문제). 거리만 보는
  // 일반 제약(구조/전단/벤드)은 "순서"를 모르기 때문에 한 번 뒤바뀌면
  // 스스로 못 푼다. 어깨 핀이 가리키는 좌→우 방향(dir)을 기준으로, 같은
  // 행에서 열 x가 열 x+1보다 그 방향으로 최소한 minGap만큼은 앞서 있도록
  // 강제해 애초에 역전이 일어나지 않게 막는다 — 페어별 O(1) 비교라 전체
  // O(cols*rows)로 자체충돌(spatial hash)보다 훨씬 저렴하다.
  //
  // minGap은 실제 열 간격(대략 폭/(cols-1), 이 프로젝트 기본값 기준 2~3cm)
  // 보다 작게 잡아야 한다 — 한때 이 값을 열 간격보다 훨씬 큰 2cm로 올려서
  // (캡슐 전용 아키텍처 시절) "순서 역전은 사라졌지만" 모든 열 사이를
  // 강제로 그만큼 벌려놔서 어깨 테이퍼 구간이 디자인 폭보다 훨씬 넓게
  // 뻥 뚫려버리는(박스/조끼 같은 실루엣) 부작용이 있었다(실측으로 확인).
  // 실제 마네킹 메시(BVH)로 돌아온 지금은 전체 실루엣을 메시 자체가
  // 결정하므로 캡슐 시절만큼 예민하지 않지만, 값을 너무 작게(예: 2mm)
  // 잡으면 BVH가 3반복마다 한 번씩(COLLISION_EVERY) 크게 밀어내는 순간을
  // 한 번의 약한 보정으로 못 따라잡아 목선 근처처럼 표면 굴곡이 급한
  // 구간에서 순서 역전이 잔류하는 문제가 실측으로 확인됐다.
  // reverse: 이 값싼 안전장치도 (구조 제약 완화와 마찬가지로) 한 방향으로만
  // 훑으면 그 방향으로 편향이 쌓인다 — 실측으로 확인: 구조 제약 쪽만
  // 정방향/역방향을 번갈아 고쳤더니 옷 왼쪽 절반은 평평해졌는데 오른쪽은
  // 여전히 늘어져 있었다(원인이 여기 하나 더 있었던 것). 호출부에서
  // 정방향 한 번 + 역방향 한 번으로 짝을 지어 불러야 편향이 상쇄된다.
  // 30번(병합): 이제 패널마다 격자 크기가 다를 수 있어(몸판 vs 소매) 이
  // 안전장치가 원래 적용되던 범위 밖(예: 소매 패널)까지 실수로 건드리지
  // 않도록 fromPanel/toPanelExclusive로 대상 패널 구간을 좁힐 수 있게
  // 했다 — 기본값(전체)은 이전 동작과 동일하다.
  preserveColumnOrder(
    dirX: number,
    dirY: number,
    dirZ: number,
    minGap = 0.006,
    reverse = false,
    fromPanel = 0,
    toPanelExclusive = this.panels,
  ): void {
    for (let p = fromPanel; p < toPanelExclusive; p++) {
      const { cols, rows } = this.panelDims[p];
      for (let y = 0; y < rows; y++) {
        for (let i = 0; i < cols - 1; i++) {
          const x = reverse ? cols - 2 - i : i;
          this.enforcePairGap(this.index(p, x, y), this.index(p, x + 1, y), dirX, dirY, dirZ, minGap);
        }
      }
    }
  }

  // preserveColumnOrder와 같은 문제가 세로 방향으로도 일어난다 — 실측으로
  // 확인: 밑단 근처(허리~엉덩이 높이) 행 전체가 위아래로 뒤집혀(같은 열의
  // 위 행이 아래 행보다 아래로 내려감) 옷자락이 찢어진 것처럼 보이는
  // 아티팩트가 새로 나타났다. 옷은 항상 어깨 핀에서 아래로 늘어지므로,
  // 기준 방향은 어깨 방향(dir)이 아니라 월드 아래 방향(중력 방향)으로
  // 고정한다 — 어느 행이든 "물리적으로 더 아래"에 있어야 할 다음 행이
  // 실제로도 더 아래에 있도록 강제한다.
  preserveRowOrder(minGap = 0.006, reverse = false, fromPanel = 0, toPanelExclusive = this.panels): void {
    for (let p = fromPanel; p < toPanelExclusive; p++) {
      const { cols, rows } = this.panelDims[p];
      for (let x = 0; x < cols; x++) {
        for (let i = 0; i < rows - 1; i++) {
          const y = reverse ? rows - 2 - i : i;
          this.enforcePairGap(this.index(p, x, y), this.index(p, x, y + 1), 0, -1, 0, minGap);
        }
      }
    }
  }

  // 목선~겨드랑이 사이 테이퍼 구간(0번 행 제외, y < rowEndExclusive)에서
  // BVH 메시 충돌이 어깨 캡의 삼각형 단위 굴곡을 그대로 따라가다 보니,
  // 바로 옆 열인데도 실제 몸통 표면의 서로 다른(미세하게 각도가 다른)
  // 삼각형에 달라붙어 인접 열끼리 들쭉날쭉한 잔물결이 생기는 문제가
  // 실측(행별 Y좌표 직접 대조, 인접 열 간 최대 2cm 차이)으로 확인됐다 —
  // 충돌을 통째로 꺼보면 이 구간이 완벽하게 매끈해지는 것도 확인해 원인을
  // 충돌 쪽으로 특정했다. 충돌 자체의 정밀도를 낮추는 대신, 매 프레임 한
  // 번씩 각 파티클을 좌우 이웃 두 점의 평균 쪽으로 살짝 당겨(라플라시안
  // 스무딩) 이 고주파 잔물결만 지우고 테이퍼의 저주파(전체 모양)는 그대로
  // 둔다. 0번 행(어깨 핀)과 맨 끝 열은 원래도 고정/기준점이라 건드리지
  // 않는다.
  smoothColumns(rowEndExclusive: number, blend = 0.5, fromPanel = 0, toPanelExclusive = this.panels): void {
    for (let p = fromPanel; p < toPanelExclusive; p++) {
      const { cols } = this.panelDims[p];
      for (let y = 1; y < rowEndExclusive; y++) {
        for (let x = 1; x < cols - 1; x++) {
          const i = this.index(p, x, y);
          if (this.pinned[i]) continue;
          const left = this.index(p, x - 1, y) * 3;
          const right = this.index(p, x + 1, y) * 3;
          const ix = i * 3;
          const avgX = (this.positions[left] + this.positions[right]) / 2;
          const avgY = (this.positions[left + 1] + this.positions[right + 1]) / 2;
          const avgZ = (this.positions[left + 2] + this.positions[right + 2]) / 2;
          this.positions[ix] += (avgX - this.positions[ix]) * blend;
          this.positions[ix + 1] += (avgY - this.positions[ix + 1]) * blend;
          this.positions[ix + 2] += (avgZ - this.positions[ix + 2]) * blend;
        }
      }
    }
  }

  // 목선(0번 행, 고정)에서 그 바로 아래(1번 행)로 넘어가는 지점에서, 앞판은
  // 가슴 쪽으로(Z 양수) 뒤판은 등 쪽으로(Z 음수) 서로 반대 방향으로 급격히
  // 갈라지는데 0번 행 자체는 완전히 평평(고정)이라, 옆에서 보면 그 경계가
  // 마치 뭔가 접히거나 튀어나온 것처럼 뚝 끊겨 보이는 문제가 실측(측면
  // 카메라 각도)으로 확인됐다 — 소매를 통째로 꺼봐도 똑같이 남아있어 소매와
  // 무관한 몸판 자체의 문제였다. smoothColumns가 가로(같은 행의 좌우 이웃)
  // 로 하는 라플라시안 스무딩을 세로 방향(같은 열의 위아래 이웃)으로도
  // 적용해, 고정된 0번 행과 그 아래 자유롭게 움직이는 행 사이의 급격한
  // 전환을 완화한다.
  smoothRows(rowEndExclusive: number, blend = 0.5, fromPanel = 0, toPanelExclusive = this.panels): void {
    for (let p = fromPanel; p < toPanelExclusive; p++) {
      const { cols, rows } = this.panelDims[p];
      for (let y = 1; y < rowEndExclusive && y < rows - 1; y++) {
        for (let x = 0; x < cols; x++) {
          const i = this.index(p, x, y);
          if (this.pinned[i]) continue;
          const above = this.index(p, x, y - 1) * 3;
          const below = this.index(p, x, y + 1) * 3;
          const ix = i * 3;
          const avgX = (this.positions[above] + this.positions[below]) / 2;
          const avgY = (this.positions[above + 1] + this.positions[below + 1]) / 2;
          const avgZ = (this.positions[above + 2] + this.positions[below + 2]) / 2;
          this.positions[ix] += (avgX - this.positions[ix]) * blend;
          this.positions[ix + 1] += (avgY - this.positions[ix + 1]) * blend;
          this.positions[ix + 2] += (avgZ - this.positions[ix + 2]) * blend;
        }
      }
    }
  }

  // preserveColumnOrder/preserveRowOrder가 공유하는 핵심 로직: 파티클 a→b
  // 방향이 dir 성분으로 최소 minGap만큼은 벌어져 있도록 강제한다.
  private enforcePairGap(a: number, b: number, dirX: number, dirY: number, dirZ: number, minGap: number): void {
    const pinnedA = this.pinned[a];
    const pinnedB = this.pinned[b];
    if (pinnedA && pinnedB) return;

    const ai = a * 3;
    const bi = b * 3;
    const dx = this.positions[bi] - this.positions[ai];
    const dy = this.positions[bi + 1] - this.positions[ai + 1];
    const dz = this.positions[bi + 2] - this.positions[ai + 2];
    const proj = dx * dirX + dy * dirY + dz * dirZ;
    if (proj >= minGap) return;

    const correction = (minGap - proj) / 2;
    const moveA = pinnedA ? 0 : pinnedB ? 1 : 0.5;
    const moveB = pinnedB ? 0 : pinnedA ? 1 : 0.5;
    if (!pinnedA) {
      this.positions[ai] -= dirX * correction * moveA;
      this.positions[ai + 1] -= dirY * correction * moveA;
      this.positions[ai + 2] -= dirZ * correction * moveA;
    }
    if (!pinnedB) {
      this.positions[bi] += dirX * correction * moveB;
      this.positions[bi + 1] += dirY * correction * moveB;
      this.positions[bi + 2] += dirZ * correction * moveB;
    }
  }

  private limitStrain(): void {
    const maxStretch = 1.2;
    for (const c of this.constraints) {
      const ai = c.a * 3;
      const bi = c.b * 3;
      const pinnedA = this.pinned[c.a];
      const pinnedB = this.pinned[c.b];
      if (pinnedA && pinnedB) continue;

      const dx = this.positions[bi] - this.positions[ai];
      const dy = this.positions[bi + 1] - this.positions[ai + 1];
      const dz = this.positions[bi + 2] - this.positions[ai + 2];
      const dist = Math.hypot(dx, dy, dz) || 1e-6;
      const maxDist = c.restLength * maxStretch;
      if (dist <= maxDist) continue;

      const diff = (dist - maxDist) / dist;
      const moveA = pinnedA ? 0 : pinnedB ? 1 : 0.5;
      const moveB = pinnedB ? 0 : pinnedA ? 1 : 0.5;

      if (!pinnedA) {
        this.positions[ai] += dx * diff * moveA;
        this.positions[ai + 1] += dy * diff * moveA;
        this.positions[ai + 2] += dz * diff * moveA;
      }
      if (!pinnedB) {
        this.positions[bi] -= dx * diff * moveB;
        this.positions[bi + 1] -= dy * diff * moveB;
        this.positions[bi + 2] -= dz * diff * moveB;
      }
    }
  }
}
