// The link-preview picture for the generator page (og:image): generator/og.jpg, 1200x630.
//   node generator/og-image.mjs            (after npm install + npx playwright install chromium in the skill folder)
// Share links carry their log after the #, which link previews (Discord, X, Slack...) never see, so every link shows
// this same picture. It's the real card, stopped before any row or score, with a "?" where the score would be, so it
// can't be mistaken for the shared work's result.
import { chromium } from 'playwright';
import http from 'node:http';
import path from 'node:path';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let page = '';
const server = http.createServer((req, res) => {
  if (req.url === '/og') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(page); }
  const f = path.join(SK, decodeURIComponent(req.url.split('?')[0]));
  if (!f.startsWith(SK) || !existsSync(f) || statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : f.endsWith('.json') ? 'application/json' : 'application/octet-stream' });
  res.end(readFileSync(f));
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;

page = `<!doctype html><html><head><meta charset="utf-8"><style>
  html, body { margin: 0; width: 1200px; height: 630px; overflow: hidden; background: #1d120d; }
  canvas { position: absolute; left: 50%; top: 50%; width: 1200px; height: 675px; transform: translate(-50%, -50%); }
  .q { position: absolute; left: 770px; top: 175px; width: 310px; height: 310px; border-radius: 50%; display: grid; place-items: center;
    background: radial-gradient(circle at 35% 30%, #ff9cc2, #e8669a 55%, #b8396c); color: #1d0b12; font: 800 230px/1 Georgia, serif;
    box-shadow: 0 0 0 12px rgba(232,102,154,.28), 0 18px 40px rgba(0,0,0,.55); padding-bottom: 10px; box-sizing: border-box; }
  .say { position: absolute; left: 112px; top: 205px; width: 510px; font-family: Georgia, "Times New Roman", serif; color: #2a1a14; }
  .say b { display: block; font-size: 42px; line-height: 1.12; }
  .say span { display: block; margin-top: 18px; font: 600 24px/1.35 system-ui, "Segoe UI", sans-serif; color: #6f5a55; }
  .say i { display: inline-block; margin-top: 22px; font: 700 20px ui-monospace, Consolas, monospace; font-style: normal; letter-spacing: .06em;
    color: #cc3f79; border: 3px solid #cc3f79; border-radius: 6px; padding: 6px 12px; transform: rotate(-3deg); }
</style></head><body>
<canvas id="c" width="1920" height="1080"></canvas>
<div class="say"><b>How much AI went into it?</b><span>Open the link to see where the AI went, and the score out of 100.</span><i>SLOP-O-METER</i></div>
<div class="q">?</div>
<script src="/player/meter-core.js"></script>
<script>
  fetch('/rubric.json').then(r => r.json()).then(rubric => {
    const m = SlopMeter.create(document.getElementById('c'), { title: 'Slop-o-meter', byline: 'your video, song, writing, image or code', uses: [], human: [] }, rubric);
    m.renderAt(0.9);   // the board is up, nothing logged yet: no rows, no number, no stamp
    window.__ready = true;
  });
</script></body></html>`;

const browser = await chromium.launch();
const pg = await browser.newPage({ viewport: { width: 1200, height: 630 } });
pg.on('pageerror', e => console.error('pageerror:', e.message));
await pg.goto(base + 'og');
await pg.waitForFunction(() => window.__ready);
await pg.evaluate(() => document.fonts.ready);
const out = path.join(SK, 'generator', 'og.jpg');
await pg.screenshot({ path: out, type: 'jpeg', quality: 88 });
console.log('wrote', out);
await browser.close(); server.close();
