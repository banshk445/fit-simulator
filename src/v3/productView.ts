/* v3-43 §2 — **제품급 표시 층**. 진단 래스터(`raster.ts`)와 «별도»이고 그것을 대체하지 않는다.
 *
 * 왜 별도인가: 진단 래스터는 원근 0 · 조명 0 · 2색 · 300×420 이라 «정당한 폐색»(v3-43 §1 확인:
 * 근측 맨팔의 전방 폐색)이 «구멍»처럼 읽힌다. 진단용으로는 그대로 두고(회차 간 대조가 끊긴다),
 * 사람이 보는 화면만 제품급으로 만든다.
 *
 * 담는 것: 원근 카메라 · 조명 3 · 정점 노멀 보간 · 톤매핑 · devicePixelRatio.
 * 담지 «않는» 것: 물리 · 조립 · 상태 변형. **입력 배열을 한 바이트도 쓰지 않는다.**
 *
 * 제품 뷰는 등재 3뷰의 «대응 구도»다 — 방위각을 같게 두어 회차 간 대조를 유지한다.
 */
import {
  ACESFilmicToneMapping, AmbientLight, BufferAttribute, BufferGeometry, Box3,
  Color, DirectionalLight, DoubleSide, Group, HemisphereLight, Mesh, MeshStandardMaterial,
  PerspectiveCamera, Scene, Texture, Vector3, WebGLRenderer,
} from 'three';

export type ProductView = { name: string; dir: [number, number, number] };
/** `raster.ts` 의 `VIEWS` 와 «같은 방위각». dir 은 그쪽과 같은 «보는 방향»이다. */
export const PRODUCT_VIEWS: ProductView[] = [
  { name: 'front-p', dir: [0, 0, -1] },
  { name: 'side-p', dir: [-1, 0, 0] },
  { name: 'back-p', dir: [0, 0, 1] },
];

/** 표시 층 파라미터 — **물리 채널이 아니다.** 값은 표시 재량이고 여기 한 곳에만 둔다. */
export const DISPLAY = {
  fovDeg: 32,
  fitMargin: 1.18,
  exposure: 1.05,
  bg: 0xf4f4f2,
  key: { color: 0xffffff, intensity: 2.4, dir: [0.55, 0.75, 0.9] },
  fill: { color: 0xdce6f5, intensity: 0.85, dir: [-0.7, 0.1, -0.55] },
  hemi: { sky: 0xe8eef7, ground: 0x3a3831, intensity: 0.75 },
  ambient: { color: 0xffffff, intensity: 0.18 },
  body: { color: 0xc9c1b6, roughness: 0.88, metalness: 0.0 },
  cloth: { color: 0x3358c8, roughness: 0.92, metalness: 0.0 },
} as const;

/* v3-59 §3 — **패널 분리 렌더**(프린트 모드). v2 `PatternPreview.tsx:359-374` 와 «같은 구조»이고
 * **코드 임포트 0**이다. 패널 4개를 각각 지오메트리로 만들어 **앞판만 텍스처**, 나머지는 단색으로 둔다
 * — v2 계약의 「앞판 = 대표색 + 가슴 프린트 / 뒤판·소매 = 단색」 형식 그대로다.
 * **핏 색과 «동시 적용하지 않는다»** — 부르는 쪽이 둘 중 하나만 넘긴다(#89 렌더 기여 갱신). */
export type PrintInput = {
  /** [0,1] 정규화 UV(`printUv.buildPrintUv` 산출) — `n × 2`. */
  uv: Float32Array;
  /** 패널 경계 — `assemble()` 의 `panels` 에서 뜬다. */
  panels: { name: string; base: number; count: number }[];
  /** 앞판에 얹을 텍스처. 없으면 전 패널 단색(계약 확인용). */
  tex?: Texture | null;
  /** 텍스처를 받을 패널 이름 — v2 계약은 «앞판»이다. */
  printPanel?: string;
  /** v3-60 — **대표색**(뒤판·소매·브리지가 «같은 색»을 쓴다). `#rrggbb` 또는 정수. */
  solid?: number;
  /** v3-60 — **브리지 복원**. 프린트 모드에서 스트립을 «대표색 단색»의 별도 지오메트리로 그린다.
   * 텍스처를 못 얹는 근거: 스트립 UV 가 **단일 패널 정규화 공간에 속하지 않는다**
   * (패널을 가로지른다 · v3-59 §3 등재) ⟹ **v3-45 «목적»(시접선을 화면에서 잇는다)만 보존**한다. */
  bridgeIdx?: Uint32Array | null;
};

type Ctx = { r: WebGLRenderer; sc: Scene; cam: PerspectiveCamera; body: Mesh; cloth: Mesh; split: Group };
const CTX = new WeakMap<HTMLCanvasElement, Ctx>();

/* v3-54 ㉢ — 핏 맵 색은 «정점색»으로 얹는다. 위치·인덱스는 그대로이고 색 속성만 붙는다
 * ⟹ **blob 무변조**(사본만 쓴다) · 지오메트리 구조 변경 0.
 * **브리지 공존 규칙**: 브리지 스트립은 «기존 정점»을 새 삼각형으로 이을 뿐 정점을 만들지 않는다
 * (v3-45 등재) ⟹ 정점색이 그대로 스트립에도 «이어진다». 스트립 전용 색을 따로 두지 않는다. */
function geom(pos: Float32Array, idx: Uint32Array, vcol?: Float32Array): BufferGeometry {
  const g = new BufferGeometry();
  /* 사본을 쓴다 — 입력 배열을 three 가 소유하지 않게 한다(무변조 보장) */
  g.setAttribute('position', new BufferAttribute(Float32Array.from(pos), 3));
  g.setIndex(new BufferAttribute(Uint32Array.from(idx), 1));
  if (vcol) g.setAttribute('color', new BufferAttribute(Float32Array.from(vcol), 3));
  g.computeVertexNormals();          // ← 스무딩 셰이딩(v3-42 §4: 각짐 34~36% 감소)
  return g;
}

function ctxOf(canvas: HTMLCanvasElement): Ctx {
  const had = CTX.get(canvas);
  if (had) return had;
  const r = new WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  r.toneMapping = ACESFilmicToneMapping;
  r.toneMappingExposure = DISPLAY.exposure;
  const sc = new Scene();
  sc.background = new Color(DISPLAY.bg);
  const cam = new PerspectiveCamera(DISPLAY.fovDeg, 1, 0.01, 100);
  const key = new DirectionalLight(DISPLAY.key.color, DISPLAY.key.intensity);
  key.position.set(...(DISPLAY.key.dir as unknown as [number, number, number]));
  const fill = new DirectionalLight(DISPLAY.fill.color, DISPLAY.fill.intensity);
  fill.position.set(...(DISPLAY.fill.dir as unknown as [number, number, number]));
  sc.add(key, fill,
    new HemisphereLight(DISPLAY.hemi.sky, DISPLAY.hemi.ground, DISPLAY.hemi.intensity),
    new AmbientLight(DISPLAY.ambient.color, DISPLAY.ambient.intensity));
  const body = new Mesh(new BufferGeometry(), new MeshStandardMaterial({ ...DISPLAY.body }));
  const cloth = new Mesh(new BufferGeometry(),
    new MeshStandardMaterial({ ...DISPLAY.cloth, side: DoubleSide }));
  sc.add(body, cloth);
  const split = new Group();
  sc.add(split);
  const c: Ctx = { r, sc, cam, body, cloth, split };
  CTX.set(canvas, c);
  return c;
}

/**
 * 한 장 그린다. **입력 배열은 읽기만 한다.**
 * `cssW/cssH` 는 CSS 픽셀이고 백킹 스토어는 `devicePixelRatio` 로 올린다.
 */
export function renderProduct(
  canvas: HTMLCanvasElement,
  body: { pos: Float32Array; idx: Uint32Array },
  cloth: { pos: Float32Array; idx: Uint32Array; vcol?: Float32Array; print?: PrintInput | null },
  view: ProductView,
  cssW: number,
  cssH: number,
  dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1,
): void {
  const c = ctxOf(canvas);
  c.body.geometry.dispose(); c.body.geometry = geom(body.pos, body.idx);
  /* 패널 분리(프린트 모드) — 이전 분할을 버리고 다시 세운다. 입력 배열은 읽기만 한다. */
  for (const m of [...c.split.children]) {
    const mm = m as Mesh;
    mm.geometry.dispose();
    (mm.material as MeshStandardMaterial).dispose();
    c.split.remove(m);
  }
  c.cloth.visible = !cloth.print;
  if (cloth.print) {
    /* 패널마다 «자기 정점만» 담은 지오메트리를 만든다 — 인덱스는 패널 기준으로 옮긴다.
     * 삼각형은 «세 정점이 모두 그 패널»인 것만 담는다(시접 브리지는 패널을 가로지르므로 빠진다). */
    const { uv, panels, tex, printPanel = 'front' } = cloth.print;
    for (const p of panels) {
      const pos3 = cloth.pos.subarray(p.base * 3, (p.base + p.count) * 3);
      const uv2 = uv.subarray(p.base * 2, (p.base + p.count) * 2);
      const ix: number[] = [];
      for (let t = 0; t < cloth.idx.length; t += 3) {
        const a = cloth.idx[t], b = cloth.idx[t + 1], d = cloth.idx[t + 2];
        const inP = (v: number) => v >= p.base && v < p.base + p.count;
        if (inP(a) && inP(b) && inP(d)) ix.push(a - p.base, b - p.base, d - p.base);
      }
      const g = new BufferGeometry();
      g.setAttribute('position', new BufferAttribute(Float32Array.from(pos3), 3));
      g.setAttribute('uv', new BufferAttribute(Float32Array.from(uv2), 2));
      g.setIndex(new BufferAttribute(Uint32Array.from(ix), 1));
      g.computeVertexNormals();
      const isPrint = tex && p.name === printPanel;
      const mat = new MeshStandardMaterial({
        ...DISPLAY.cloth, side: DoubleSide,
        color: isPrint ? 0xffffff : (cloth.print.solid ?? DISPLAY.cloth.color),
        map: isPrint ? tex : null,
      });
      c.split.add(new Mesh(g, mat));
    }
    /* v3-60 — 브리지 스트립: **대표색 단색**의 별도 지오메트리(텍스처 0 · UV 0). */
    const bi = cloth.print.bridgeIdx;
    if (bi && bi.length) {
      const g = new BufferGeometry();
      g.setAttribute('position', new BufferAttribute(Float32Array.from(cloth.pos), 3));
      g.setIndex(new BufferAttribute(Uint32Array.from(bi), 1));
      g.computeVertexNormals();
      c.split.add(new Mesh(g, new MeshStandardMaterial({
        ...DISPLAY.cloth, side: DoubleSide,
        color: cloth.print.solid ?? DISPLAY.cloth.color,
      })));
    }
  }
  c.cloth.geometry.dispose(); c.cloth.geometry = geom(cloth.pos, cloth.idx, cloth.vcol);
  /* 색이 오면 정점색을 켜고 기저색을 흰색으로 둔다(곱해지므로) · 없으면 등재 기본색 그대로 */
  const cm = c.cloth.material as MeshStandardMaterial;
  cm.vertexColors = !!cloth.vcol;
  cm.color.set(cloth.vcol ? 0xffffff : DISPLAY.cloth.color);
  cm.needsUpdate = true;

  const bb: Box3 = new Box3().setFromBufferAttribute(c.body.geometry.getAttribute('position') as BufferAttribute);
  bb.union(new Box3().setFromBufferAttribute(c.cloth.geometry.getAttribute('position') as BufferAttribute));
  const mid = bb.getCenter(new Vector3());

  c.r.setPixelRatio(dpr);
  c.r.setSize(cssW, cssH, false);
  c.cam.aspect = cssW / cssH;
  /* 세로가 좁으면 세로 화각이 구속한다 — 두 축 중 빡빡한 쪽으로 맞춘다 */
  const vFov = (DISPLAY.fovDeg * Math.PI) / 180;
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * c.cam.aspect);
  /* bbox 대각으로 맞추면 T 포즈 팔 스팬(±89cm)이 거리를 지배해 인물이 작아진다.
   * 화면 축(u = 시선×up · v = up)에 «투영»한 반폭으로 맞추고, 깊이 반폭만 거리에 더한다. */
  const dv = view.dir;
  const ux = dv[2], uz = -dv[0];                       // up=(0,1,0) 과의 외적
  const ul = Math.hypot(ux, uz) || 1;
  const U = [ux / ul, 0, uz / ul];
  let hu = 0, hv = 0, hd = 0;
  for (let k = 0; k < 8; k++) {
    const px = (k & 1 ? bb.max.x : bb.min.x) - mid.x;
    const py = (k & 2 ? bb.max.y : bb.min.y) - mid.y;
    const pz = (k & 4 ? bb.max.z : bb.min.z) - mid.z;
    hu = Math.max(hu, Math.abs(px * U[0] + pz * U[2]));
    hv = Math.max(hv, Math.abs(py));
    hd = Math.max(hd, Math.abs(px * dv[0] + py * dv[1] + pz * dv[2]));
  }
  const dist = DISPLAY.fitMargin *
    Math.max(hu / Math.tan(hFov / 2), hv / Math.tan(vFov / 2)) + hd;
  c.cam.position.set(mid.x - view.dir[0] * dist, mid.y - view.dir[1] * dist, mid.z - view.dir[2] * dist);
  c.cam.lookAt(mid);
  c.cam.updateProjectionMatrix();
  c.r.render(c.sc, c.cam);
}
