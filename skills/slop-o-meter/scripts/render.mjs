// Render the slop-o-meter card, with its sound.
//   node scripts/render.mjs <slop.json> <out.mp4> [fps]          full card: frames piped to ffmpeg + sfx.py audio (48 kHz AAC)
//   node scripts/render.mjs <slop.json> --stills <dir> t1 t2 ...  PNG stills for checking
// Needs: npm install, npx playwright install chromium, ffmpeg on PATH, python 3 with numpy.
// The skill folder is served over http (fetch() does not work from file://); the manifest goes to the page as window.SLOP.
import { chromium } from 'playwright';
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, unlinkSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!f.startsWith(ROOT) || !existsSync(f) || statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f).toLowerCase()] || 'application/octet-stream' }); res.end(readFileSync(f));
});
await new Promise(r => server.listen(0, '127.0.0.1', r));

const [manifestPath, out, ...rest] = process.argv.slice(2);
if (!manifestPath || !out) { console.error('usage: node scripts/render.mjs <slop.json> <out.mp4> [fps] | <slop.json> --stills <dir> t...'); process.exit(2); }
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

const browser = await chromium.launch();
const pg = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
pg.on('pageerror', e => console.error('pageerror:', e.message));
pg.on('console', m => m.type() === 'error' && console.error('page:', m.text()));
await pg.addInitScript(m => { window.SLOP = m; }, manifest);
await pg.goto(`http://127.0.0.1:${server.address().port}/player/index.html?render=1`);
await pg.waitForFunction(() => window.__ready === true || window.__failed, null, { timeout: 30000 });
const failed = await pg.evaluate(() => window.__failed);
if (failed) { console.error('page failed:', failed); process.exit(1); }
await pg.evaluate(() => document.fonts.ready);
const info = await pg.evaluate(() => ({ duration: window.DURATION, events: window.EVENTS, score: window.SCORE, verdict: window.VERDICT }));
console.log(`score ${info.score} / 100 -> ${info.verdict}, ${info.duration.toFixed(2)} s`);
const grab = t => pg.evaluate(t => { window.renderAt(t); return document.getElementById('c').toDataURL('image/png').split(',')[1]; }, t);

if (out === '--stills') {
  const [dir, ...ts] = rest; mkdirSync(dir, { recursive: true });
  for (const t of ts.length ? ts : ['0', String(info.duration - 0.01)]) writeFileSync(path.join(dir, `t_${(+t).toFixed(2).padStart(6, '0')}.png`), Buffer.from(await grab(+t), 'base64'));
  console.log('stills in', dir);
} else {
  const fps = +(rest[0] || 30), n = Math.ceil(info.duration * fps);
  const evFile = out.replace(/\.mp4$/i, '') + '.events.json', wav = out.replace(/\.mp4$/i, '') + '.wav';
  writeFileSync(evFile, JSON.stringify({ duration: info.duration, events: info.events }, null, 1));
  const py = spawnSync(process.platform === 'win32' ? 'python' : 'python3', [path.join(ROOT, 'scripts', 'sfx.py'), evFile, wav], { stdio: 'inherit' });
  if (py.status !== 0) { console.error('sfx.py failed'); process.exit(1); }
  const ff = spawn('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'image2pipe', '-framerate', String(fps), '-i', '-', '-i', wav,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '16', '-preset', 'medium', '-c:a', 'aac', '-b:a', '256k', '-ar', '48000', '-shortest', '-movflags', '+faststart', out],
    { stdio: ['pipe', 'inherit', 'inherit'] });
  for (let i = 0; i < n; i++) {
    const b = Buffer.from(await grab(i / fps), 'base64');
    if (!ff.stdin.write(b)) await new Promise(r => ff.stdin.once('drain', r));
  }
  ff.stdin.end(); await new Promise(r => ff.on('close', r));
  try { unlinkSync(evFile); } catch {}
  console.log('wrote', out, n, 'frames');
}
await browser.close(); server.close();
