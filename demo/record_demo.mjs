// Records the README demo: drives the review harness like a person would (fake cursor, captions) and saves an MP4
// (Chrome's screencast frames, put together by ffmpeg on the PATH).
//   sh demo/make_demo_project.sh /tmp/aivcr-demo
//   node skills/review-harness/scripts/review_server.mjs 5190 /tmp/aivcr-demo
//   node demo/record_demo.mjs http://127.0.0.1:5190/ demo/out /tmp/aivcr-demo   (needs: npm i playwright; npx playwright install chromium)
// Two rounds: a note on draft 1, draft 2 lands and the note is accepted, a second note, draft 3 lands, accepted.
// then: sh demo/to_gif.sh demo/out/demo.mp4 assets/demo.gif
import path from 'node:path'; import { mkdirSync, writeFileSync, rmSync, readdirSync, renameSync } from 'node:fs'; import { execFileSync } from 'node:child_process';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const URL = process.argv[2] || 'http://127.0.0.1:5190/', OUT = path.resolve(process.argv[3] || 'demo/out'), PROJECT = path.resolve(process.argv[4] || '/tmp/aivcr-demo');
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

// a full-screen card for the time Claude spends on the next draft
const card = (t, on) => page.evaluate(([t, on]) => { let c = document.getElementById('dcard');
  if (!c) { c = document.createElement('div'); c.id = 'dcard'; c.style.cssText = 'position:fixed;inset:0;z-index:99996;display:flex;align-items:center;justify-content:center;background:rgba(8,8,12,.93);color:#fff;font:600 30px/1.35 system-ui,sans-serif;text-align:center;padding:0 80px;white-space:pre-line;transition:opacity .3s;opacity:0'; document.body.appendChild(c); }
  c.textContent = t; c.style.opacity = on ? 1 : 0; }, [t, on]);
const ready = () => page.waitForFunction(() => { const v = document.getElementById('vid'); return v.readyState >= 3 && !v.seeking; }, null, { timeout: 30000 });
// the next draft lands: move it out of staged/ (where make_demo_project.sh put it) into out/, as a render would
const deliver = n => { for (const f of readdirSync(path.join(PROJECT, 'staged')).filter(f => f.startsWith(`draft${n}`))) renameSync(path.join(PROJECT, 'staged', f), path.join(PROJECT, 'out', f)); };
const seekTo = async t => { const tl = await box('#tl'); const dur = await page.evaluate(() => document.getElementById('vid').duration); await click(tl.b.x + tl.b.width * t / dur, tl.y); await wait(500); };
const drag = async (p, x0, y0, x1, y1) => { const [a, b] = at(p, x0, y0), [c, d] = at(p, x1, y1); await move(a, b); await page.mouse.down(); await move(c, d, 20); await page.mouse.up(); await wait(400); };
const note = async text => { const n = await box('#note'); await click(n.x, n.y); await wait(250); await page.keyboard.type(text, { delay: 32 }); await wait(350); await page.keyboard.press('Enter'); await wait(900); };
const doneBtn = async () => { const d = await box('#done'); await click(d.x, d.y); await wait(1200); };
// open the earlier note, sweep the before/after divider across the picture, then accept it
const accept = async () => { const o = await box('#tabOld'); await click(o.x, o.y); await wait(700);
  const t = await box('#notes li.old .tx'); await click(t.x, t.y); await wait(900);
  const c = await page.locator('#cmp').boundingBox(), y = c.y + c.height * .7;
  await move(c.x + c.width * .5, y); await page.mouse.down();
  await move(c.x + c.width * .92, y, 28); await wait(500); await move(c.x + c.width * .08, y, 50); await wait(600); await move(c.x + c.width * .5, y, 28);
  await page.mouse.up(); await wait(900);
  const a = await page.locator('#notes li.old button.fx').first().boundingBox(); await click(a.x + a.width / 2, a.y + a.height / 2); await wait(1000);
  await page.keyboard.press('Escape'); const cu = await box('#tabCur'); await click(cu.x, cu.y); await wait(300); };
const nextRound = async (n, text) => { await cap(''); await card(text, true); await wait(2200); deliver(n); await page.reload(); await ready(); await wait(300); await startCast(); };

await page.goto(URL); await page.mouse.move(mx, my);
await page.waitForFunction(() => document.getElementById('vid').readyState >= 3, null, { timeout: 30000 });
await wait(500); await startCast(); await wait(500);

// round 1: daytime, ask for night
await cap('Draft 1. Watch it, stop where something is wrong.');
await seekTo(13.2); await wait(1200);
let p = await pic();
await cap('Box what you mean. Drew a wrong one? Right-click it away.');
await drag(p, .03, .03, .5, .32); await drag(p, .55, .5, .8, .75); await wait(500);
{ const [a, b] = at(p, .67, .62); await click(a, b, { button: 'right' }); } await wait(800);
await cap('Type the note. It keeps the frame, the shot, the lyric and a picture with your boxes.');
await note('This should be night. Put a moon over the sea.');
await cap('Done sends the round to Claude.'); await doneBtn();
await nextRound(2, 'Claude reads the note, opens the boxed frame,\nand renders draft 2');

// round 2: night arrives, but the moon is dull
await cap('Draft 2. Cyan on the timeline = what changed. Press c to jump there.');
{ const s = await box('#tl .chg'); await move(s.x, s.y - 2, 22); } await wait(1400);
await page.keyboard.press('c'); await wait(2700); await page.keyboard.press(' '); await wait(500);
await cap('Open your note: drag across to wipe between the frame you marked and the new draft.');
await accept();
await cap('Night works. The moon is too dull.');
p = await pic(); await drag(p, .15, .04, .27, .22); await wait(400);
await note('Moon is too dull. Make it big and bright, lighting up the water.');
await doneBtn();
await nextRound(3, 'Claude makes draft 3');

// round 3: the bright moon
await cap('Draft 3. The heatmap under the strip: this spot has now been reworked twice.');
{ const s = await box('#tl .chg'); await move(s.x, s.y + 8, 22); } await wait(1600);
await page.keyboard.press('c'); await wait(2700); await page.keyboard.press(' '); await wait(500);
await cap('Before and after. Accept it and the note closes.');
await accept();
await cap('Two notes, two drafts, both fixed. Nothing lost between rounds.'); await wait(2400);
await cap(''); await wait(400);
await cdp.send('Page.stopScreencast'); await browser.close();
const name = i => `${String(i).padStart(5, '0')}.jpg`;
const list = shots.map((t, i) => `file '${name(i)}'\nduration ${Math.max(0.001, Math.min(1, (shots[i + 1] ?? t + 0.5) - t)).toFixed(4)}`);
writeFileSync(path.join(FR, 'list.txt'), [...list, `file '${name(shots.length - 1)}'`].join('\n') + '\n');
const mp4 = path.join(OUT, 'demo.mp4');
execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', path.join(FR, 'list.txt'), '-vf', 'fps=30,scale=1280:-2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', mp4], { cwd: FR });
console.log('recorded', mp4, shots.length, 'frames');
