// README picture for the slop-o-meter: the generator page, filled in, its card on the final frame.
//   node demo/slop-o-meter/shoot.mjs <out_dir>
// Run from the repo root after `npm install` in skills/slop-o-meter. demo/slop-o-meter/make.sh calls it.
import { createRequire } from 'node:module';
import http from 'node:http';
import path from 'node:path';
import { existsSync, readFileSync, statSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SK = path.join(REPO, 'skills', 'slop-o-meter');
const { chromium } = createRequire(path.join(SK, 'package.json'))('playwright');
const out = process.argv[2] || path.join(REPO, 'assets', 'slop-o-meter');
mkdirSync(out, { recursive: true });

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const f = path.join(SK, decodeURIComponent(req.url.split('?')[0]).replace(/\/$/, '/index.html'));
  if (!f.startsWith(SK) || !existsSync(f) || statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' }); res.end(readFileSync(f));
});
await new Promise(r => server.listen(0, '127.0.0.1', r));

const browser = await chromium.launch();
const pg = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
pg.on('pageerror', e => console.error('pageerror:', e.message));
// open the generator as a shared link carrying the example log, so the form is filled in and the meter shows it
const m = JSON.parse(readFileSync(path.join(SK, 'examples', 'example.json'), 'utf8'));
const hash = Buffer.from(JSON.stringify(m), 'utf8').toString('base64');
await pg.goto(`http://127.0.0.1:${server.address().port}/generator/#m=${hash}`);
await pg.waitForFunction(() => /\d/.test(document.querySelector('.gen-score')?.textContent || ''));
// a shared link autoplays: let it play to the end, where the verdict is stamped
await pg.evaluate(() => { document.querySelector('.gen-shared').hidden = true; window.scrollTo(0, 0); });
await pg.waitForFunction(() => /pause/i.test(document.querySelector('.m-play').textContent), null, { timeout: 10000 });
await pg.waitForFunction(() => /play/i.test(document.querySelector('.m-play').textContent), null, { timeout: 40000 });
await pg.waitForTimeout(400);
await pg.screenshot({ path: path.join(out, 'generator.png') });
console.log('wrote generator.png to', out);
await browser.close(); server.close();
