import type { Object3D } from "three";

// Mannequin.tsx가 마운트되면 자신의 최상위 렌더 그룹(전체 키 스케일 + 접지
// 오프셋까지 적용된 실제 루트)을 여기에 채워 넣는다. GarmentCloth는 이
// 레퍼런스를 읽어서, 화면에 실제로 렌더되는 것과 동일한 좌표계 기준으로
// 충돌용 정적 메시를 굽는다(별도로 마네킹을 다시 로드/래핑하면 스케일·
// 오프셋이 어긋나기 때문).
export const mannequinRootRef: { current: Object3D | null } = { current: null };
