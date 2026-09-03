/* v4-25 §1-② — **팔 축 인자를 «한 곳»에서 읽는다**(계기 식 0줄 · 새 수 0).
 *
 * 소비자 넷(`v4AsmExport` · `v4Armpit` · `v4AposeRender` · `v4ProductGate`)이 각자 `prepare()` 로
 * 장면을 다시 세우므로 **축이 다르면 패널·정점 수가 갈린다** ⟹ 같은 파일에서 같은 값을 읽는다.
 *
 * `ARM_AXIS_JSON=<l3ap-body-….json>` — v4-17/18 이 «뼈에서 읽어» 적어 둔 축을 그대로 쓴다
 * (`팔축_후`[0] = 왼팔 · [1] = 오른팔 · 손 상수 0 · 함정 44 「노트에서 읽어 옮긴다」).
 * 없으면 `undefined` — 그러면 `garmentScene.ts:635` 의 기본 **+x** 다(기존 경로 바이트 불변).
 */
import { readFileSync } from 'node:fs';

export type Vec3 = [number, number, number];
export type ArmAxis = { left: Vec3; right: Vec3; origin?: { left: Vec3; right: Vec3 } };

export function armAxisFromEnv(): ArmAxis | undefined {
  const p = process.env.ARM_AXIS_JSON;
  if (!p) return undefined;
  const j = JSON.parse(readFileSync(p, 'utf8')) as { 팔축_후?: { name: string; dir: number[] }[] };
  const rows = j.팔축_후;
  if (!rows || rows.length < 2) throw new Error(`팔 축 파일에 «팔축_후» 가 없다 — ${p}`);
  const pick = (want: 'Left' | 'Right') => {
    const r = rows.find((x) => x.name.includes(want));
    if (!r) throw new Error(`팔 축 파일에 ${want} 뼈가 없다 — ${p}`);
    return r.dir as [number, number, number];
  };
  /* v4-26 §1-① — 대역 원점 C. `ARM_ORIGIN_JSON` 이 있으면 «중심선투영»을 실어 보낸다(§0-4ㄱ).
   * 없으면 `origin` 자체가 없고, `garmentScene` 은 분기를 안 탄다(옛 식 그대로). */
  const op = process.env.ARM_ORIGIN_JSON;
  let origin: { left: Vec3; right: Vec3 } | undefined;
  if (op) {
    const o = JSON.parse(readFileSync(op, 'utf8')) as
      { left?: { 중심선투영?: Vec3 }; right?: { 중심선투영?: Vec3 } };
    const L = o.left?.중심선투영, R = o.right?.중심선투영;
    if (!L || !R) throw new Error(`원점 파일에 «중심선투영» 이 없다 — ${op}`);
    origin = { left: L, right: R };
  }
  return { left: pick('Left'), right: pick('Right'), ...(origin ? { origin } : {}) };
}
