import { useTexture } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useFitStore } from "../store/useFitStore";
import { CHEST_HEIGHT_RATIO } from "../constants";

interface Props {
  imageUrl: string;
}

// 평면을 그대로 띄우면 "몸 위에 사진을 붙여놓은" 느낌이라 어색하다. 대신
// 정점이 촘촘한 평면을 만들고, 정점 쉐이더에서 가상의 원통에 감듯이 좌우
// 가장자리를 뒤쪽(Z-)으로 구부린다. CylinderGeometry에 텍스처를 입히는
// 방식과 달리 UV를 그대로 쓰므로 이미지 비율이 절대 왜곡되지 않는다.
const SEGMENTS = 48;

const vertexShader = /* glsl */ `
  uniform float uWidth;
  uniform float uHeight;
  uniform float uRadius;
  varying vec2 vUv;

  void main() {
    vUv = uv;
    float localX = position.x * uWidth;
    float localY = position.y * uHeight;
    float theta = localX / uRadius;
    float bentX = sin(theta) * uRadius;
    float bentZ = uRadius - cos(theta) * uRadius;
    vec3 bentPosition = vec3(bentX, localY, -bentZ);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(bentPosition, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform sampler2D uMap;
  varying vec2 vUv;

  void main() {
    gl_FragColor = texture2D(uMap, vUv);
  }
`;

export function GarmentOverlay({ imageUrl }: Props) {
  const texture = useTexture(imageUrl);
  const garmentSize = useFitStore((s) => s.garmentSize);
  const bodySize = useFitStore((s) => s.bodySize);
  const meshRef = useRef<THREE.Mesh>(null);
  const materialRef = useRef<THREE.ShaderMaterial>(null);

  // 원통과 동일한 계산식(품 기반 반지름, 총장, 가슴높이)을 그대로 재사용해서
  // 옷 실측 슬라이더 영역(품×총장)을 "박스"로 삼는다.
  const radiusM = garmentSize.width / (2 * Math.PI) / 100;
  const boxWidthM = radiusM * 2;
  const boxHeightM = garmentSize.length / 100;

  // 이미지 원본 비율을 유지한 채 박스 안에 맞춘다(contain) — 박스보다 이미지가
  // 가로로 길면 가로에 맞추고 세로는 남고, 세로로 길면 그 반대. 이렇게 하면
  // 품/총장 비율에 억지로 맞춰 늘리지 않아 이미지가 절대 찌그러지지 않는다.
  const image = texture.image as HTMLImageElement | undefined;
  const imageAspect = image && image.width && image.height ? image.width / image.height : 1;
  const boxAspect = boxWidthM / boxHeightM;
  const widthM = imageAspect > boxAspect ? boxWidthM : boxHeightM * imageAspect;
  const heightM = imageAspect > boxAspect ? boxWidthM / imageAspect : boxHeightM;

  const centerY = (bodySize.height / 100) * CHEST_HEIGHT_RATIO;
  const offsetZ = radiusM + 0.01;
  // 곡률: 값이 작을수록 더 많이 감싸듯 휘고, 클수록 평평해진다.
  const bendRadius = widthM * 0.66;

  const uniforms = useMemo(
    () => ({
      uMap: { value: texture },
      uWidth: { value: widthM },
      uHeight: { value: heightM },
      uRadius: { value: bendRadius },
    }),
    // 초기값만 설정하고, 이후 크기 변화는 useFrame에서 직접 lerp한다.
    [texture],
  );

  useFrame((_, delta) => {
    const mesh = meshRef.current;
    const mat = materialRef.current;
    if (!mesh || !mat) return;
    const t = 1 - Math.pow(0.001, delta);
    mat.uniforms.uWidth.value = THREE.MathUtils.lerp(mat.uniforms.uWidth.value, widthM, t);
    mat.uniforms.uHeight.value = THREE.MathUtils.lerp(mat.uniforms.uHeight.value, heightM, t);
    mat.uniforms.uRadius.value = THREE.MathUtils.lerp(mat.uniforms.uRadius.value, bendRadius, t);
    mesh.position.y = THREE.MathUtils.lerp(mesh.position.y, centerY, t);
    mesh.position.z = THREE.MathUtils.lerp(mesh.position.z, offsetZ, t);
  });

  return (
    <mesh ref={meshRef} position={[0, centerY, offsetZ]}>
      <planeGeometry args={[1, 1, SEGMENTS, SEGMENTS]} />
      <shaderMaterial
        ref={materialRef}
        uniforms={uniforms}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        transparent
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}
