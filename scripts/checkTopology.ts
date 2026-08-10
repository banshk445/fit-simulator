// P18 §3 — **위상 일반화가 «이름만 바꾼 것»이 아닌지 확인한다.**
//
// §2의 게이트는 「티셔츠가 안 깨졌다」만 말한다. 그것으로는 셔츠·커프 밴드가 실제로
// 통과할지 알 수 없다. 그래서 **패널 구성이 다른 가상 입력**을 자료구조에 통과시킨다.
// 옷을 만들지 않는다 — 물리도 제도도 부르지 않고 **위상 자료구조만** 시험한다.
//
// 시험 대상(=다음 판이 이어받을 인터페이스):
//   `makePanelTopology(roles, panelStarts)`  역할 질의(정점→패널·역할·역할별 패널)
//   미러 표 규약  `mirrorPanel[p]` + `mirrorLocal[p]`(null = 항등)
//
// 실행: `npm run check:topology` (물리 0 · 제도 0 · 몇 ms)
import { makePanelTopology, type PanelRole } from "../src/lib/patternGarment";

let fails = 0;
const ok = (name: string, cond: boolean, detail = ""): void => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

const startsOf = (counts: number[]): number[] => {
  const out: number[] = [];
  let off = 0;
  for (const c of counts) { out.push(off); off += c; }
  return out;
};

console.log("\n[topology] 1. 티셔츠 구성(현행) — 종전 인덱스 관례와 같은 분할인가");
{
  const roles: PanelRole[] = ["torsoFront", "torsoBack", "sleeve", "sleeve"];
  const counts = [2134, 2162, 474, 474];
  const starts = startsOf(counts);
  const t = makePanelTopology(roles, starts);
  const total = counts.reduce((a, b) => a + b, 0);
  // 종전 관례: i < panelStarts[2] 이면 몸판
  let same = 0;
  for (let i = 0; i < total; i++) if (t.isTorso(i) === (i < starts[2])) same++;
  ok("몸판 판정이 종전 관례와 전 정점 일치", same === total, `${same}/${total}`);
  ok("panelOf가 경계에서 정확", t.panelOf(0) === 0 && t.panelOf(starts[1]) === 1 && t.panelOf(starts[1] - 1) === 0 && t.panelOf(total - 1) === 3);
  ok("소매 패널 2개", t.panelsWithRole("sleeve").join(",") === "2,3");
}

console.log("\n[topology] 2. 셔츠형 5패널(앞판 2매 · 뒤판 1 · 소매 2) — 자료구조가 견디는가");
{
  // 앞여밈이면 앞판이 좌/우로 갈린다 ⟹ 같은 역할 패널이 «둘»이다.
  const roles: PanelRole[] = ["torsoFront", "torsoFront", "torsoBack", "sleeve", "sleeve"];
  const counts = [1100, 1100, 2162, 474, 474];
  const starts = startsOf(counts);
  const t = makePanelTopology(roles, starts);
  const total = counts.reduce((a, b) => a + b, 0);
  ok("앞판 역할 패널이 2개로 잡힌다", t.panelsWithRole("torsoFront").join(",") === "0,1");
  ok("뒤판 1개 · 소매 2개", t.panelsWithRole("torsoBack").join(",") === "2" && t.panelsWithRole("sleeve").join(",") === "3,4");
  ok("두 앞판 모두 몸판으로 판정", t.isTorso(0) && t.isTorso(starts[1]) && t.isTorso(starts[2] - 1));
  ok("소매 첫/마지막 정점이 소매로 판정", t.roleOf(starts[3]) === "sleeve" && t.roleOf(total - 1) === "sleeve");
  ok("몸판/소매 경계가 «인덱스 2»가 아니다(관례 붕괴 확인)", starts[2] !== starts[3] && t.isTorso(starts[2]));
  // 리졸버 배열이 패널 수만큼 나오는가 — `patternDressCore`가 쓰는 것과 같은 식
  const resolvers = t.roles.map((r) => (r === "torsoFront" ? "front" : r === "torsoBack" ? "back" : null));
  ok("리졸버 배열이 5칸(4칸 고정 아님)", resolvers.length === 5, resolvers.map((x) => x ?? "null").join(","));
}

console.log("\n[topology] 3. 커프 밴드형 6패널(몸판 2 · 소매 2 · 커프 2) — 새 역할 없이도 서는가");
{
  // 밴드는 소매 역할로 둔다(팔 캡슐이 맡는 대역이라는 뜻은 같다).
  const roles: PanelRole[] = ["torsoFront", "torsoBack", "sleeve", "sleeve", "sleeve", "sleeve"];
  const counts = [2134, 2162, 474, 474, 120, 120];
  const starts = startsOf(counts);
  const t = makePanelTopology(roles, starts);
  const total = counts.reduce((a, b) => a + b, 0);
  ok("소매 역할 패널이 4개", t.panelsWithRole("sleeve").join(",") === "2,3,4,5");
  ok("마지막 밴드 정점이 소매로 판정", t.roleOf(total - 1) === "sleeve");
  ok("몸판은 여전히 앞뒤 2개", t.panelsWithRole("torsoFront").length === 1 && t.panelsWithRole("torsoBack").length === 1);
}

console.log("\n[topology] 4. 미러 표 규약 — 쌍이 둘 이상이어도 대합(involution)인가");
{
  // 미러 쌍 2개: 소매 2↔3, 커프 4↔5. 앞판 2매는 서로의 미러(0↔1).
  const counts = [1100, 1100, 474, 474, 120, 120];
  const starts = startsOf(counts);
  const mirrorPanel = [1, 0, 3, 2, 5, 4];
  const mirrorLocal: (Int32Array | null)[] = [null, null, null, null, null, null];
  const total = counts.reduce((a, b) => a + b, 0);
  const mirrorOf = new Int32Array(total);
  for (let p = 0; p < counts.length; p++) {
    const loc = mirrorLocal[p];
    for (let i = 0; i < counts[p]; i++) mirrorOf[starts[p] + i] = starts[mirrorPanel[p]] + (loc ? loc[i] : i);
  }
  let bad = 0;
  for (let i = 0; i < total; i++) if (mirrorOf[mirrorOf[i]] !== i) bad++;
  ok("미러 쌍 3벌에서 대합 성립", bad === 0, `위반 ${bad}/${total}`);

  // 패널 «안»에서 미러되는 경우(현행 앞/뒤판)도 같은 규약으로 서는가
  const counts2 = [6, 6];
  const starts2 = startsOf(counts2);
  const local = Int32Array.from([5, 4, 3, 2, 1, 0]);
  const mp = [0, 1];
  const ml: (Int32Array | null)[] = [local, local];
  const tot2 = 12;
  const m2 = new Int32Array(tot2);
  for (let p = 0; p < counts2.length; p++) {
    const lo = ml[p];
    for (let i = 0; i < counts2[p]; i++) m2[starts2[p] + i] = starts2[mp[p]] + (lo ? lo[i] : i);
  }
  let bad2 = 0;
  for (let i = 0; i < tot2; i++) if (m2[m2[i]] !== i) bad2++;
  ok("패널 «안» 미러도 같은 규약으로 대합", bad2 === 0, `위반 ${bad2}/${tot2}`);
}

console.log(`\n[topology] ${fails === 0 ? "전부 통과" : `**실패 ${fails}건**`}`);
if (fails > 0) process.exit(1);
