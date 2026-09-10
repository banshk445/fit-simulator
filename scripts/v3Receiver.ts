/* v3-86 §1-⑤ — **자산 반출 수신기**(상시 · 정식 승격).
 *
 * 왜 있는가: 굽기 산출물은 브라우저 안에서 만들어지는데 **브라우저가 자동 다운로드를 막는다**
 * (v3-85 실측 — 2건째부터 차단, 이후 전면 차단). 다운로드에 기대면 자산이 나오지 않는다.
 * 그래서 페이지가 **바이트를 여기로 POST** 하고, 이쪽이 **sha 를 대조한 뒤에만** 파일로 떨군다.
 *
 * 규약
 *   POST /put?name=<파일명>&sha256=<64자>   body = 바이트 그대로
 *     · `name` 은 **경로 구분자·상위 참조 금지**(파일명만) · 저장 위치는 `--out` 아래
 *     · **sha 불일치면 저장 0** 이고 409 를 돌려준다(조용한 저장 금지)
 *     · 저장에 성공하면 200 + 저장 경로
 *   기대한 파일 수(`--n`, 기본 1)를 받으면 **자동 종료**한다(상주 0).
 *
 * 진입: `npx tsx scripts/v3Receiver.ts --out public/v3diag/v3-77 --n 1 [--port 5199]`
 */
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, basename } from 'node:path';

const arg = (k: string, d: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d;
};
const OUT = resolve(arg('out', 'public/v3diag'));
const PORT = Number(arg('port', '5199'));
const WANT = Number(arg('n', '1'));
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

let done = 0;
const cors = (res: import('node:http').ServerResponse) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
};

const srv = createServer((req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') { res.writeHead(204).end(); return; }
  if (req.method !== 'POST') { res.writeHead(405).end('POST only'); return; }
  const u = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`);
  /* 파일명은 «basename» 으로 잘라 상위 경로 탈출을 원천 차단한다. */
  const name = basename(u.searchParams.get('name') ?? '');
  const want = (u.searchParams.get('sha256') ?? '').toLowerCase();
  if (!name || !/^[0-9a-f]{64}$/.test(want)) { res.writeHead(400).end('name·sha256 필요'); return; }
  const chunks: Buffer[] = [];
  req.on('data', (c) => chunks.push(c as Buffer));
  req.on('end', () => {
    const buf = Buffer.concat(chunks);
    const got = createHash('sha256').update(buf).digest('hex');
    if (got !== want) {
      /* ★ 불일치면 **저장하지 않는다**. 조용히 받아 두면 틀린 자산이 정본이 된다. */
      console.log(`[수신] ✗ ${name} — sha 불일치(기대 ${want.slice(0, 16)}… · 실제 ${got.slice(0, 16)}…) · **저장 0**`);
      res.writeHead(409).end(`sha 불일치 ${got}`);
      return;
    }
    const path = resolve(OUT, name);
    writeFileSync(path, buf);
    done += 1;
    console.log(`[수신] ✓ ${name} · ${buf.length} bytes · sha ${got.slice(0, 16)}… → ${path}  (${done}/${WANT})`);
    res.writeHead(200).end(path);
    if (done >= WANT) { console.log('[수신] 기대 수 도달 — 종료'); srv.close(() => process.exit(0)); }
  });
});
srv.listen(PORT, '127.0.0.1', () =>
  console.log(`[수신] 127.0.0.1:${PORT} 대기 · out=${OUT} · 기대 ${WANT}건 · sha 대조 후에만 저장`));
