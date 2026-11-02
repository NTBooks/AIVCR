// README picture for the slop-o-meter: the generator page on one of its questions, answered from the example log.
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
const pg = await browser.newPage({ viewport: { width: 1100, height: 940 }, deviceScaleFactor: 1 });
pg.on('pageerror', e => console.error('pageerror:', e.message));
// the example log as this browser's saved draft, so the check opens with its answers filled in
const m = JSON.parse(readFileSync(path.join(SK, 'examples', 'example.json'), 'utf8'));
const url = `http://127.0.0.1:${server.address().port}/generator/`;
await pg.goto(url);
await pg.evaluate(m => localStorage.setItem('slop-o-meter-draft', JSON.stringify({ ...m, kind: 'video', answered: ['writing', 'direction', 'video',
  'audio', 'images', 'code', 'helpers', 'mograph', 'sfx', 'research', 'cleanup', 'mastering'] })), m);
await pg.goto(url);
await pg.waitForSelector('input[name=kind]:checked');
// step through to the music question: kind, name, then the video kind's questions in order
for (let i = 0; i < 20 && !/music and vocals/.test(await pg.textContent('.wiz-q-h')); i++) await pg.click('[data-wiz=next]');
await pg.mouse.move(0, 0);
await pg.waitForTimeout(400);   // let the step's slide-in finish
await pg.screenshot({ path: path.join(out, 'generator.png') });
console.log('wrote generator.png to', out);
await browser.close(); server.close();
