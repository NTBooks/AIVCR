// Records the README demo: drives the review harness like a person would (fake cursor, captions) and saves an MP4
// (Chrome's screencast frames, put together by ffmpeg on the PATH).
//   sh demo/make_demo_project.sh /tmp/aivcr-demo
//   node skills/review-harness/scripts/review_server.mjs 5190 /tmp/aivcr-demo
//   node demo/record_demo.mjs http://127.0.0.1:5190/ demo/out        (needs: npm i playwright; npx playwright install chromium)
// then: sh demo/to_gif.sh demo/out/demo.mp4 assets/demo.gif
import path from 'node:path'; import { mkdirSync, writeFileSync, rmSync } from 'node:fs'; import { execFileSync } from 'node:child_process';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const URL = process.argv[2] || 'http://127.0.0.1:5190/', OUT = path.resolve(process.argv[3] || 'demo/out');
const W = 1280, H = 720;
const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
const ctx = await browser.newContext({ viewport: { width: W, height: H } });
const FR = path.join(OUT, 'frames'); rmSync(FR, { recursive: true, force: true }); mkdirSync(FR, { recursive: true });
// a cursor the recording can see, a click ripple, and a caption bar
await ctx.addInitScript(() => addEventListener('DOMContentLoaded', () => {
  const s = document.createElement('style'); s.textContent = `
    #dcur { position: fixed; z-index: 99999; width: 22px; height: 22px; pointer-events: none; left: -50px; top: -50px;
      background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 22 22'%3E%3Cpath d='M2 2 L2 18 L7 13 L11 21 L14 19.5 L10 12 L17 12 Z' fill='white' stroke='black' stroke-width='1.4'/%3E%3C/svg%3E") no-repeat; }
    .drip { position: fixed; z-index: 99998; width: 34px; height: 34px; margin: -17px; border-radius: 50%; border: 3px solid #ffd100; pointer-events: none; animation: drip .5s ease-out forwards; }
    .drip.r { border-color: #ff5a4a; }
    @keyframes drip { from { transform: scale(.3); opacity: 1 } to { transform: scale(1.4); opacity: 0 } }
    #dcap { position: fixed; z-index: 99997; left: calc((100% - 380px) / 2); top: 372px; transform: translateX(-50%); width: max-content; max-width: 820px; padding: 10px 18px; border-radius: 8px;
      background: rgba(10,10,14,.88); color: #fff; font: 600 19px/1.3 system-ui, sans-serif; text-align: center; box-shadow: 0 4px 20px #0008; transition: opacity .25s; }
    #dcap:empty { opacity: 0; }`;
  document.head.appendChild(s);
  const c = document.createElement('div'); c.id = 'dcur'; document.body.appendChild(c);
  const cap = document.createElement('div'); cap.id = 'dcap'; document.body.appendChild(cap);
  addEventListener('mousemove', e => { c.style.left = e.clientX - 2 + 'px'; c.style.top = e.clientY - 2 + 'px'; }, true);
  addEventListener('mousedown', e => { const r = document.createElement('div'); r.className = 'drip' + (e.button === 2 ? ' r' : ''); r.style.left = e.clientX + 'px'; r.style.top = e.clientY + 'px'; document.body.appendChild(r); setTimeout(() => r.remove(), 600); }, true);
}));
const page = await ctx.newPage();
// every painted frame with its timestamp; ffmpeg holds each one until the next
const cdp = await ctx.newCDPSession(page), shots = [];
cdp.on('Page.screencastFrame', async f => { const n = shots.length; writeFileSync(path.join(FR, `${String(n).padStart(5, '0')}.jpg`), Buffer.from(f.data, 'base64'));
  shots.push(f.metadata.timestamp); try { await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }); } catch {} });
const startCast = () => cdp.send('Page.startScreencast', { format: 'jpeg', quality: 90, maxWidth: W, maxHeight: H, everyNthFrame: 1 });
const wait = ms => page.waitForTimeout(ms);
const cap = t => page.evaluate(t => { document.getElementById('dcap').textContent = t; }, t);
let mx = W / 2, my = H / 2;
const move = async (x, y, steps = 18) => { await page.mouse.move(x, y, { steps }); mx = x; my = y; };
const click = async (x, y, opts) => { await move(x, y); await wait(150); await page.mouse.click(x, y, opts); };
const box = async sel => { const b = await page.locator(sel).first().boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2, b }; };
// the picture inside the video element, so boxes land on frame coordinates
const pic = () => page.evaluate(() => { const v = document.getElementById('vid'), r = v.getBoundingClientRect(), s = Math.min(r.width / v.videoWidth, r.height / v.videoHeight);
  return { x: r.left + (r.width - v.videoWidth * s) / 2, y: r.top + (r.height - v.videoHeight * s) / 2, w: v.videoWidth * s, h: v.videoHeight * s }; });
const at = (p, fx, fy) => [p.x + fx * p.w, p.y + fy * p.h];

await page.goto(URL); await page.mouse.move(mx, my);
// start filming once the video has loaded and the change strip is drawn, so the GIF never opens on a spinner
await page.waitForFunction(() => { const v = document.getElementById('vid'); return v.readyState >= 3 && !v.seeking && document.querySelectorAll('#tl .chg').length > 0; }, null, { timeout: 30000 });
await wait(500); await startCast(); await wait(800);
await cap('Draft 3 of a video. Cyan = what changed since draft 2. Red heat underneath = spots reworked again and again.');
const tl = await box('#tl'); await move(tl.b.x + tl.b.width * .2, tl.y); await wait(900);
const chg = await box('#tl .chg'); await move(chg.x, chg.y - 2, 22); await wait(1800);
await cap('Press c to jump to the next change. It starts 1.5 s early so you see it in context.');
await page.keyboard.press('c'); await wait(2600);
await page.keyboard.press(' '); await wait(400);
await cap('Paused. Drag boxes over what you mean.');
let p = await pic();
let [a, b] = at(p, .165, .045), [c, d] = at(p, .255, .2);   // around the moon in the night shot
await move(a, b); await page.mouse.down(); await move(c, d, 20); await page.mouse.up(); await wait(500);
[a, b] = at(p, .55, .4); [c, d] = at(p, .8, .62);
await move(a, b); await page.mouse.down(); await move(c, d, 20); await page.mouse.up(); await wait(900);
await cap('Drew one by mistake? Right-click it to remove it.');
[a, b] = at(p, .67, .51); await click(a, b, { button: 'right' }); await wait(1300);
await cap('Type the note. It saves the frame, shot, lyric line and a picture of the frame with your boxes.');
const note = await box('#note'); await click(note.x, note.y); await wait(300);
await page.keyboard.type('Moon reads well. Make it glow a little and drop the sky one stop.', { delay: 38 });
await wait(400); await page.keyboard.press('Enter'); await wait(1600);
await cap('Earlier rounds: notes from past drafts stay open until you accept them.');
const old = await box('#tabOld'); await click(old.x, old.y); await wait(1300);
const acc = page.locator('#notes li.old').filter({ hasText: 'Still no night' }).locator('button.fx');
const ab = await acc.boundingBox(); await click(ab.x + ab.width / 2, ab.y + ab.height / 2); await wait(1500);
await cap('Changes: every changed stretch, click to watch it.');
const ch = await box('#tabChg'); await click(ch.x, ch.y); await wait(1200);
const row = await box('#notes li.chgrow'); await click(row.x, row.y); await wait(2200);
await page.keyboard.press(' ');
await cap('Done sends the round to Claude, which reads every note and opens every marked frame first.');
const done = await box('#done'); await click(done.x, done.y); await wait(2600);
await cap(''); await wait(400);
await cdp.send('Page.stopScreencast'); await browser.close();
const name = i => `${String(i).padStart(5, '0')}.jpg`;
const list = shots.map((t, i) => `file '${name(i)}'\nduration ${Math.max(0.001, (shots[i + 1] ?? t + 0.5) - t).toFixed(4)}`);
writeFileSync(path.join(FR, 'list.txt'), [...list, `file '${name(shots.length - 1)}'`].join('\n') + '\n');
const mp4 = path.join(OUT, 'demo.mp4');
execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', path.join(FR, 'list.txt'), '-vf', 'fps=30,scale=1280:-2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', mp4], { cwd: FR });
console.log('recorded', mp4, shots.length, 'frames');
