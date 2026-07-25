# Fit Simulator

옷 실측 치수(총장/품/어깨너비/소매길이/소매통)와 몸 치수를 입력하면,
3D 마네킹에 그 치수 그대로의 옷감을 씌워 실제로 입었을 때의 핏을
시뮬레이션한다. 옷 사진을 업로드하면 원단색/프린트를 추출해 텍스처로
입히고, 물리 기반(PBD) 천 시뮬레이션으로 중력·충돌·소매 형태를 계산해
"이 옷이 내 몸에 맞을까"를 실측 기반으로 미리 확인할 수 있다. 핏 맵
기능으로는 어디가 타이트하고 어디가 헐렁한지도 색으로 바로 읽을 수 있다.

## 스택

- React 19 + TypeScript + Vite
- Three.js / [@react-three/fiber](https://github.com/pmndrs/react-three-fiber) — 3D 렌더링
- [three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh) — 옷감-마네킹 충돌/최근접점 질의 가속
- Zustand — 상태 관리(몸 치수, 옷 치수, 렌더 토글 등)
- Tailwind CSS — UI
- Electron — 데스크톱 앱 패키징(`npm run electron:pack`)
- 옷감 물리는 Web Worker(`src/workers/garmentWorker.ts`)에서 Position-Based
  Dynamics로 매 프레임 계산 — 메인 스레드는 그 결과를 정점 셰이더로
  렌더링만 담당한다(`Garment.tsx`의 `injectProxyBinding`).

## 실행

```bash
npm install
npm run dev            # 웹(브라우저)
npm run electron:pack  # 데스크톱 앱 패키징(dist/mac-arm64/)
```

## 핏 맵

옷감 정점마다 마네킹 표면까지의 여유(BVH 최근접점 질의, `signedClearance`)를
계산해, 정착된 옷 형태를 텍스처 대신 색으로 보여주는 기능이다. "어깨는
딱 맞고 품은 헐렁하다" 같은 걸 한눈에 읽을 수 있게 한다. 물리 계산에는
전혀 관여하지 않는 순수 조회다 — Controls 패널의 "핏 맵" 체크박스로
켠다.

색 범례(0/1/3cm 경계, 색상 모두 실측이 아니라 눈대중 초기값 — 경계마다
부드럽게 보간됨):

| 색 | 의미 | 여유 |
|---|---|---|
| 보라 | 관통(디버그용) | < 0cm |
| 빨강 | 타이트 | 0 ~ 1cm |
| 노랑 | 적정 | 1 ~ 3cm |
| 파랑 | 헐렁 | 3cm 이상 |

슬라이더별 반응 검증 스크린샷은 [docs/fit-map-validation.md](docs/fit-map-validation.md)
참고.

## 알려진 한계

- **소매 형태**: 소맷부리(커프) 근처에 삼각형으로 뾰족하게 튀어나오는
  아티팩트가 있다 — 원인과 재설계 방향은
  [docs/sleeve-redesign.md](docs/sleeve-redesign.md)에 정리돼 있다.
  근본 원인은 소매 반경(단면)이 길이 방향 감쇠 계수(`armRowFactor`)에
  같이 눌리는 것이라, 걷어내는 재설계가 진행 중이다.
- **올오버 프린트 원단색 추출**: 원단 대표색을 사진 프레임 가장자리
  띠에서 뽑는 방식(`garmentTextureComposite.ts`의 `borderRepresentativeColor`)
  이라, 프레임 전체를 패턴이 덮는 올오버 프린트(하와이안 셔츠, 카모
  패턴 등)에서는 대표색이 정확하지 않을 수 있다 — 이 방식은 "테두리는
  민무늬 원단, 중앙에만 프린트 박스가 있는 옷"을 전제로 설계됐다.
