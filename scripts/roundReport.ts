// 회차 보고 raw 링크 블록 생성기 — 전략 세션에 붙여넣을 마크다운을 stdout으로 낸다.
// 인프라 전용: 시뮬레이션 코드를 읽지도 부르지도 않는다.
//
// 진입:
//   npm run report                  기본 = 직전 회차 노트 커밋..HEAD
//   npm run report -- HEAD~3..HEAD  범위 지정
//   npm run report -- --copy        pbcopy로 클립보드에 넣는다
//   npm run report -- --parse <응답파일>   첫 줄 태그 → 종료 코드(자동진행 0 · 정지 2)
//   npm run report -- --selftest    인코딩·태그 파서 자체 검사
//
// 핵심 값은 URL 200 검증이다 — SHA가 어긋난 링크가 전략 세션에 가는 것을 막는다(함정 20).
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const REPO = "banshk445/fit-simulator";

const git = (...args: string[]) =>
  execFileSync("git", ["-c", "core.quotepath=false", ...args], { encoding: "utf8" }).trim();

/** 경로 세그먼트별 퍼센트 인코딩 — 슬래시는 인코딩하지 않는다. */
export function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

/** 첫 줄 대괄호 태그 → 종료 코드. 태그가 없거나 모호하면 2(정지) — 기본값은 안전 쪽. */
export function parseTag(firstLine: string): 0 | 2 {
  const tag = firstLine.match(/\[([^\]]*)\]/)?.[1] ?? "";
  if (tag.includes("정지")) return 2;
  if (tag.includes("자동진행")) return 0;
  return 2;
}

// ── --parse ────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const parseIdx = argv.indexOf("--parse");
if (parseIdx >= 0) {
  const file = argv[parseIdx + 1];
  if (!file) {
    console.error("[report] --parse <응답파일> 이 필요하다.");
    process.exit(2);
  }
  const first = readFileSync(file, "utf8").split("\n")[0] ?? "";
  const code = parseTag(first);
  console.log(`[report] 첫 줄: ${first.trim() || "(빈 줄)"}`);
  console.log(`[report] 판정: ${code === 0 ? "자동진행" : "정지·판단필요(태그 없음 포함)"} → exit ${code}`);
  process.exit(code);
}

// ── --selftest ─────────────────────────────────────────────────────────────
if (argv.includes("--selftest")) {
  const eq = (got: unknown, want: unknown, what: string) => {
    if (JSON.stringify(got) !== JSON.stringify(want))
      throw new Error(`${what}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
  };
  eq(encodePath("docs/metrics-log.md"), "docs/metrics-log.md", "ASCII 경로 불변");
  eq(encodePath(".obsidian-log/회차/2b-93-소매형상채널.md"),
     ".obsidian-log/%ED%9A%8C%EC%B0%A8/2b-93-%EC%86%8C%EB%A7%A4%ED%98%95%EC%83%81%EC%B1%84%EB%84%90.md",
     "한글 세그먼트 인코딩 · 슬래시 보존");
  eq(parseTag("[자동진행] 다음 회차 투입"), 0, "자동진행");
  eq(parseTag("[정지·판단필요] 갈래 미해당"), 2, "정지");
  eq(parseTag("태그 없이 시작하는 응답"), 2, "태그 없음 → 정지");
  eq(parseTag("[자동진행 그러나 정지]"), 2, "모호하면 정지");
  console.log("[report] selftest OK (6/6)");
  process.exit(0);
}

// ── 범위 결정 ──────────────────────────────────────────────────────────────
const flags = new Set(argv.filter((a) => a.startsWith("--")));
const range = argv.find((a) => !a.startsWith("--")) ?? defaultRange();

/** 직전 회차 노트 커밋 = 회차/ 디렉터리를 건드린 커밋 중 두 번째로 최근인 것. */
function defaultRange(): string {
  const notes = git("log", "-2", "--format=%H", "--", ".obsidian-log/회차/").split("\n").filter(Boolean);
  if (notes.length === 0) return "HEAD~1..HEAD";
  return `${notes[1] ?? `${notes[0]}~1`}..HEAD`;
}

const SECTIONS = [
  { title: ".obsidian-log/", match: (p: string) => p.startsWith(".obsidian-log/") },
  { title: "docs/", match: (p: string) => p.startsWith("docs/") },
  { title: "src/ · scripts/", match: (p: string) => p.startsWith("src/") || p.startsWith("scripts/") },
  { title: "기타", match: () => true },
];

type Entry = { status: "신규" | "수정"; path: string };

const raw = git("diff", "--name-status", "-M", range);
const deleted: string[] = [];
const entries: Entry[] = [];
for (const line of raw.split("\n").filter(Boolean)) {
  const cols = line.split("\t");
  const code = cols[0]![0]!;
  const path = cols[cols.length - 1]!; // R/C는 마지막 열이 새 경로
  if (code === "D") deleted.push(path);
  else entries.push({ status: code === "A" ? "신규" : "수정", path });
}

// ── 블록 생성 ──────────────────────────────────────────────────────────────
const urls: { path: string; url: string }[] = [];
const out: string[] = [`## raw 링크 (${range})`, ""];

const shaCache = new Map<string, string>();
const lastSha = (path: string) => {
  if (!shaCache.has(path)) shaCache.set(path, git("log", "-1", "--format=%H", "--", path));
  return shaCache.get(path)!;
};

const claimed = new Set<string>();
for (const section of SECTIONS) {
  const mine = entries.filter((e) => !claimed.has(e.path) && section.match(e.path));
  mine.forEach((e) => claimed.add(e.path));
  if (mine.length === 0) continue;
  out.push(`### ${section.title}`);
  for (const status of ["신규", "수정"] as const) {
    const group = mine.filter((e) => e.status === status);
    if (group.length === 0) continue;
    out.push(status);
    for (const e of group) {
      const sha = lastSha(e.path);
      if (!sha) {
        out.push(`- ${e.path} — `, `  (커밋 없음 — URL 산출 불가)`);
        continue;
      }
      const url = `https://raw.githubusercontent.com/${REPO}/${sha}/${encodePath(e.path)}`;
      urls.push({ path: e.path, url });
      if (e.path.endsWith(".png")) {
        out.push(`- ${e.path}`, `  ${url}`, `  ※ 이미지는 채팅에 직접 업로드 필요`);
      } else {
        out.push(`- ${e.path} — `, `  ${url}`);
      }
    }
  }
  out.push("");
}

if (deleted.length > 0) {
  out.push("### 삭제(D · 링크 없음)");
  deleted.forEach((p) => out.push(`- ${p}`));
  out.push("");
}

if (entries.length === 0 && deleted.length === 0) out.push("(범위 안 변경 파일 없음)", "");

const block = out.join("\n");
console.log(block);

if (flags.has("--copy")) {
  execFileSync("pbcopy", { input: block });
  console.error(`[report] 클립보드에 넣었다 (${block.split("\n").length}줄)`);
}

// ── URL 200 검증 ───────────────────────────────────────────────────────────
const bad: string[] = [];
for (const { path, url } of urls) {
  const code = execFileSync("curl", ["-sI", "-o", "/dev/null", "-w", "%{http_code}", url], {
    encoding: "utf8",
  }).trim();
  if (code !== "200") bad.push(`${code}  ${path}\n      ${url}`);
}
console.error(`[report] URL 검증 ${urls.length - bad.length}/${urls.length} 200`);
if (bad.length > 0) {
  console.error(`[report] 200이 아닌 링크 ${bad.length}건 — 붙여넣지 마라(미푸시 또는 SHA 어긋남):`);
  bad.forEach((b) => console.error(`  ${b}`));
  process.exit(1);
}
