// Review harness: a local video page that knows its frame, with a note box. Notes save to review/notes_<draft>.json.
// Built for Long Brown Bun (user: "give me a video window to watch that knows the frames it is on with a text box ... then
// tell you when it's all done to import"). Plays the full-quality master (out/draftN.mp4, or out/draftN_review.mp4 if present).
//   node review_server.mjs [port] [project dir]   ->  http://127.0.0.1:5190/   (the user types notes, presses Done; read review/notes_<draft>.json)
//   project dir defaults to the folder above this script (a project's own tools/ copy); REVIEW_ROOT works too
// GET  /                       the page (review/harness.html)
// GET  /api/drafts             drafts available (every out/draftN.mp4, newest first)
// GET  /api/meta?draft=draft8  shot list (out/draft8_shots.json, written by debug_burn.py) + lyric lines (player/lines.json)
// GET  /api/notes?draft=..     notes so far      POST /api/notes {draft, frame, time, shot, line, text}
// POST /api/delete {draft,id}  remove a note      POST /api/done {draft}  mark the round finished (review/notes_<draft>.done)
// POST /api/notes may carry rects [{x,y,w,h}] (fractions of the frame) and img (a JPEG data URL of the frame with the boxes drawn): saved as review/notes_<draft>/<id>.jpg
// GET  /api/history?draft=  notes from every earlier draft (+ their verdicts)   POST /api/verdict {draft, noteDraft, id, verdict: fixed|broken|null}
// GET  /api/changes?draft=   regions changed since the previous draft (out/<draft>_changes.json, written by changes.py):
//                              {regions: [{t0, t1, label}]} in song time; the page tints them on the timeline. A draft with
//                              no change list (or one older than its video) gets one made here, so the strip and heatmap
//                              never depend on the project's render pipeline remembering to run changes.py
// GET  /api/heat?draft=      {bin, counts[], max, drafts}: per half-second, how many earlier drafts changed it (the timeline heatmap)
// GET  /out/<file>             video, with Range support so the player can seek
import http from 'node:http'; import { readFileSync, writeFileSync, existsSync, statSync, readdirSync, mkdirSync, unlinkSync } from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url'; import { spawn } from 'node:child_process';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(process.argv[3] || process.env.REVIEW_ROOT || path.join(HERE, '..')), PORT = +(process.argv[2] || 5190);
for (const d of ['out', 'review']) mkdirSync(path.join(ROOT, d), { recursive: true });
const notesFile = d => path.join(ROOT, 'review', `notes_${d}.json`);
const readNotes = d => existsSync(notesFile(d)) ? JSON.parse(readFileSync(notesFile(d), 'utf8')) : [];
const json = (res, o, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(o)); };
const body = req => new Promise(r => { let b = ''; req.on('data', c => b += c); req.on('end', () => { try { r(JSON.parse(b || '{}')); } catch { r({}); } }); });
// the lyric lines, wherever this project keeps them (template: player/lines.json; Glazy: audio/lyrics.json)
const linesFor = () => { for (const f of ['player/lines.json', 'player/data/lines.json', 'audio/lyrics.json']) { const p = path.join(ROOT, f); if (!existsSync(p)) continue;
  const j = JSON.parse(readFileSync(p, 'utf8')), L = Array.isArray(j) ? j : j.lines ?? []; return L.filter(l => l.t0 != null).map(l => ({ t0: l.t0, t1: l.t1, text: l.text })); } return []; };
const safe = d => /^[\w-]+$/.test(d || '') ? d : null;
// One harness, several videos (user, 2026-10-25: "make 1 harness with multiple tabs when we have multiple shorts and a cut
// apart video in the same project"): a draft can carry a piece prefix, <piece>-draftN (ps-draft1, short1-draft2); no prefix =
// the main video. Drafts, notes, earlier rounds, the heatmap and the change list all stay inside their own piece; the page
// shows one tab per piece (labels from out/pieces.json {"": "Main talk", "ps": "P.S."}).
const DRE = /^(?:([a-z][a-z0-9]*)-)?draft(\d+)([a-z]?)$/;
const pieceOf = s => (DRE.exec(s || '') || [])[1] || '';
const numOf = s => { const m = DRE.exec(s || ''); return m ? +m[2] + (m[3] ? (m[3].charCodeAt(0) - 96) / 100 : 0) : 0; };
const sameDraftsBefore = (d, names) => names.filter(x => DRE.test(x) && pieceOf(x) === pieceOf(d) && numOf(x) < numOf(d));
// the diff from the previous draft, made on demand (user, 2026-10-31: "make sure the skill always pulls in the heatmap and
// the diff from previous, I noticed on new project I have to ask to get it added back"): every draft without an up-to-date
// out/<draft>_changes.json is queued for changes.py (one at a time, it decodes video), at startup and whenever the page asks
const PY = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3'), CHANGES = path.join(HERE, 'changes.py');
const videoDrafts = () => readdirSync(path.join(ROOT, 'out')).filter(f => f.endsWith('.mp4')).map(f => f.slice(0, -4)).filter(d => DRE.test(d));
const changesState = d => {
  const v = path.join(ROOT, 'out', `${d}.mp4`), c = path.join(ROOT, 'out', `${d}_changes.json`);
  if (!existsSync(v) || existsSync(path.join(ROOT, 'out', `${d}.rendering.json`))) return 'wait';
  if (!sameDraftsBefore(d, videoDrafts()).length) return 'first';
  return existsSync(c) && statSync(c).mtimeMs >= statSync(v).mtimeMs ? 'ok' : 'stale';
};
const queue = [], failed = new Set(); let busy = null;
function ensureChanges(d) {
  if (!existsSync(CHANGES) || failed.has(d) || busy === d || queue.includes(d) || changesState(d) !== 'stale') return;
  queue.push(d); queue.sort((a, b) => numOf(a) - numOf(b)); pump();   // earlier drafts first: the heatmap is built from them
}
function pump() {
  if (busy || !queue.length) return; busy = queue.shift(); const d = busy;
  console.log(`changes: ${d} vs the draft before it`);
  const ch = spawn(PY, [CHANGES, d], { cwd: ROOT, env: { ...process.env, REVIEW_ROOT: ROOT }, stdio: 'inherit' });
  let ended = false; const end = code => { if (ended) return; ended = true; if (code) { failed.add(d); console.log(`changes.py failed on ${d} (exit ${code}); no change strip for it`); } busy = null; pump(); };
  ch.on('exit', end); ch.on('error', e => { console.log(`changes.py could not start (${PY}): ${e.message}`); end(1); });
}
http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x'), p = u.pathname;
  if (p === '/' || p === '/index.html') { res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' }); return res.end(readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'review_harness.html'))); }
  // a draft still rendering (user, 2026-10-26: "preload the harness with the video that's loading and it just shows me a
  // progress bar until it's ready"): the render writes out/<draft>.rendering.json and removes it once the review copy is
  // made. Such a draft is listed first; /api/progress gives its bars from the render board (localhost:4477/runs).
  if (p === '/api/progress') {
    const d = safe(u.searchParams.get('draft')), mk = path.join(ROOT, 'out', `${d}.rendering.json`);
    if (!d || !existsSync(mk)) return json(res, { pending: false });
    const m = JSON.parse(readFileSync(mk, 'utf8') || '{}'), proj = path.basename(ROOT);
    let runs = [], board = false;
    try {
      const r = await (await fetch('http://127.0.0.1:4477/runs', { signal: AbortSignal.timeout(2000) })).json(); board = true;
      runs = (r.runs || []).filter(x => x.project === proj && (x.status === 'running' || (x.endedAt && x.endedAt > (m.started || 0))))
        .map(x => ({ job: x.job, pct: x.pct ?? 0, eta: x.eta, step: x.step, where: x.where, done: x.status !== 'running' }));
    } catch {}
    // safety net: nothing of this project is rendering and a finished video newer than the marker exists, so the marker
    // was left behind (the review copy step didn't run): clear it rather than leave the page waiting
    const done = f => existsSync(f) && statSync(f).mtimeMs > (m.started || 0);
    const vid = path.join(ROOT, 'out', `${d}_review.mp4`), master = path.join(ROOT, 'out', `${d}.mp4`);
    if (board && !runs.some(x => !x.done) && (done(vid) || (done(master) && Date.now() - statSync(master).mtimeMs > 120000))) {
      try { unlinkSync(mk); } catch {} return json(res, { pending: false });
    }
    return json(res, { pending: true, label: m.label || d, started: m.started, runs });
  }
  if (p === '/api/drafts') {
    const pending = readdirSync(path.join(ROOT, 'out')).map(f => /^(.+)\.rendering\.json$/.exec(f)?.[1]).filter(d => d && DRE.test(d));
    const ds = readdirSync(path.join(ROOT, 'out')).filter(f => DRE.test(f.replace(/\.mp4$/, '')) && f.endsWith('.mp4')).map(f => f.replace('.mp4', ''))
      .map(d => ({ d, m: statSync(path.join(ROOT, 'out', d + '.mp4')).mtimeMs, part: existsSync(path.join(ROOT, 'out', d + '_span.json')) }))
      .sort((a, b) => (a.part - b.part) || (b.m - a.m)).map(x => x.d);   // full drafts first (newest first), partial spans after: the page opens on the newest FULL draft
    return json(res, [...pending.filter(d => !ds.includes(d)), ...ds].sort((a, b) => (pending.includes(b) - pending.includes(a))));
  }
  if (p === '/api/pieces') { const f = path.join(ROOT, 'out', 'pieces.json'); return json(res, existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : {}); }
  if (p === '/api/changes') {
    const d = safe(u.searchParams.get('draft')), f = path.join(ROOT, 'out', `${d}_changes.json`);
    if (!d) return json(res, { regions: [] });
    sameDraftsBefore(d, videoDrafts()).forEach(ensureChanges); ensureChanges(d);   // the heatmap needs the earlier drafts' lists too
    const st = changesState(d), mine = [d, ...sameDraftsBefore(d, videoDrafts())];
    const computing = mine.some(x => busy === x || queue.includes(x));
    const o = existsSync(f) && st === 'ok' ? JSON.parse(readFileSync(f, 'utf8')) : { regions: [] };
    return json(res, { ...o, computing, first: st === 'first' });
  }
  // the heatmap: for every half-second of the song, how many EARLIER drafts changed it (out/<x>_changes.json, written by
  // tools/changes.py); the page paints it under the timeline so the spots that keep getting reworked glow hottest
  if (p === '/api/heat') {
    const d = safe(u.searchParams.get('draft'));
    const BIN = .5, files = sameDraftsBefore(d, readdirSync(path.join(ROOT, 'out')).map(f => /^(.+)_changes\.json$/.exec(f)?.[1]).filter(Boolean));
    const counts = []; for (const x of files) { const regs = JSON.parse(readFileSync(path.join(ROOT, 'out', `${x}_changes.json`), 'utf8')).regions || [];
      const hit = new Set(); for (const r of regs) for (let i = Math.floor(r.t0 / BIN); i < Math.ceil(r.t1 / BIN); i++) hit.add(i);
      for (const i of hit) counts[i] = (counts[i] || 0) + 1; }
    for (let i = 0; i < counts.length; i++) counts[i] = counts[i] || 0;
    return json(res, { bin: BIN, counts, max: Math.max(0, ...counts), drafts: files.length });
  }
  if (p === '/api/meta') {
    const d = safe(u.searchParams.get('draft')); const sf = path.join(ROOT, 'out', `${d}_shots.json`);
    const spf = path.join(ROOT, 'out', `${d}_span.json`), span = existsSync(spf) ? JSON.parse(readFileSync(spf, 'utf8')) : null;   // partial revisions
    const sh2 = existsSync(sf) ? sf : [...readdirSync(path.join(ROOT, 'out'))].filter(f => /_shots\.json$/.test(f)).sort().map(f => path.join(ROOT, 'out', f)).pop();
    const lf = path.join(ROOT, 'out', `${d}_lines.json`);   // a piece's own subtitles (setup_review writes them), else the project's
    const lines = existsSync(lf) ? (JSON.parse(readFileSync(lf, 'utf8')).lines || []) : linesFor();
    return json(res, { shots: sh2 && existsSync(sh2) ? JSON.parse(readFileSync(sh2, 'utf8')) : [], lines, span });
  }
  if (p === '/api/notes' && req.method === 'GET') return json(res, readNotes(safe(u.searchParams.get('draft'))));
  if (p === '/api/notes' && req.method === 'POST') {
    const n = await body(req), d = safe(n.draft); if (!d || !n.text) return json(res, { error: 'draft and text needed' }, 400);
    const notes = readNotes(d); const note = { id: Date.now(), frame: n.frame, time: n.time, shot: n.shot, line: n.line, text: String(n.text).slice(0, 2000) };
    // rectangles the user dragged over the paused frame: [{x, y, w, h}] as fractions of the frame (0..1, from the top-left)
    const rects = Array.isArray(n.rects) ? n.rects.filter(r => r && [r.x, r.y, r.w, r.h].every(v => typeof v === 'number' && v >= -0.01 && v <= 1.01)).slice(0, 8)
      .map(r => ({ x: +r.x.toFixed(4), y: +r.y.toFixed(4), w: +r.w.toFixed(4), h: +r.h.toFixed(4) })) : [];
    if (rects.length) note.rects = rects;
    // the frame itself with the rectangles drawn on it (a JPEG Claude can open): review/notes_<draft>/<id>.jpg
    if (typeof n.img === 'string' && n.img.startsWith('data:image/jpeg;base64,') && n.img.length < 3e6) {
      const dir = path.join(ROOT, 'review', `notes_${d}`); mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, `${note.id}.jpg`), Buffer.from(n.img.slice(23), 'base64')); note.img = `review/notes_${d}/${note.id}.jpg`; }
    notes.push(note); notes.sort((a, b) => a.frame - b.frame); writeFileSync(notesFile(d), JSON.stringify(notes, null, 1)); return json(res, note);
  }
  // earlier rounds: every note from the drafts before this one, so the page can put them on the timeline and ask "fixed?"
  if (p === '/api/history') {
    const d = safe(u.searchParams.get('draft')), num = numOf;
    const prev = sameDraftsBefore(d, readdirSync(path.join(ROOT, 'review')).map(f => /^notes_(.+)\.json$/.exec(f)?.[1]).filter(Boolean)).sort((a, b) => num(a) - num(b));
    // verdicts from every review up to this one: an accepted note stays accepted in later drafts; "still broken" is per draft
    const vfs = readdirSync(path.join(ROOT, 'review')).map(f => /^verdicts_(.+)\.json$/.exec(f)?.[1]).filter(x => x && DRE.test(x) && pieceOf(x) === pieceOf(d) && num(x) <= num(d)).sort((a, b) => num(a) - num(b));
    const verdicts = {}; for (const x of vfs) { const v = JSON.parse(readFileSync(path.join(ROOT, 'review', `verdicts_${x}.json`), 'utf8')); for (const k in v) if (v[k] === 'fixed' || x === d) verdicts[k] = v[k]; }
    const mine = existsSync(path.join(ROOT, 'review', `verdicts_${d}.json`)) ? JSON.parse(readFileSync(path.join(ROOT, 'review', `verdicts_${d}.json`), 'utf8')) : {};
    for (const k in verdicts) if (!(k in mine) && verdicts[k] !== 'fixed') delete verdicts[k];
    return json(res, prev.flatMap(x => readNotes(x).map(n => ({ ...n, draft: x, verdict: verdicts[`${x}:${n.id}`] || null }))));
  }
  // "fixed?" verdicts on earlier notes, judged while watching this draft: review/verdicts_<draft>.json {"draftN:id": "fixed" | "broken"}
  if (p === '/api/verdict' && req.method === 'POST') {
    const n = await body(req), d = safe(n.draft), k = `${safe(n.noteDraft)}:${+n.id}`; if (!d || !n.noteDraft) return json(res, { error: 'draft needed' }, 400);
    const vf = path.join(ROOT, 'review', `verdicts_${d}.json`), v = existsSync(vf) ? JSON.parse(readFileSync(vf, 'utf8')) : {};
    if (n.verdict) v[k] = n.verdict === 'fixed' ? 'fixed' : 'broken'; else delete v[k]; writeFileSync(vf, JSON.stringify(v, null, 1)); return json(res, { ok: true });
  }
  // the marked-up frames saved with notes
  if (p.startsWith('/review/notes_')) { const f = path.join(ROOT, decodeURIComponent(p)); if (!f.startsWith(path.join(ROOT, 'review')) || !existsSync(f)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store' }); return res.end(readFileSync(f)); }
  if (p === '/api/delete' && req.method === 'POST') { const n = await body(req), d = safe(n.draft); writeFileSync(notesFile(d), JSON.stringify(readNotes(d).filter(x => x.id !== n.id), null, 1)); return json(res, { ok: true }); }
  if (p === '/api/done' && req.method === 'POST') { const n = await body(req), d = safe(n.draft); writeFileSync(path.join(ROOT, 'review', `notes_${d}.done`), new Date().toISOString()); return json(res, { ok: true, count: readNotes(d).length }); }
  if (p.startsWith('/out/')) {
    const f = path.join(ROOT, decodeURIComponent(p)); if (!f.startsWith(path.join(ROOT, 'out')) || !existsSync(f)) { res.writeHead(404); return res.end(); }
    const size = statSync(f).size, range = req.headers.range;
    if (range) { const [a, b] = range.replace('bytes=', '').split('-'); const s = +a, e = b ? Math.min(+b, size - 1) : size - 1;   // the standard answer: to the end; a seek closes it (below)
      res.writeHead(206, { 'Content-Type': 'video/mp4', 'Content-Range': `bytes ${s}-${e}/${size}`, 'Accept-Ranges': 'bytes', 'Content-Length': e - s + 1 });
      const fd = (await import('node:fs')).createReadStream(f, { start: s, end: e }); res.on('close', () => fd.destroy()); fd.on('error', () => res.destroy()); return fd.pipe(res); }   // a seek abandons the old range: close its stream
    if (req.method === 'HEAD') { res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': size, 'Accept-Ranges': 'bytes' }); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': size, 'Accept-Ranges': 'bytes' }); const st = (await import('node:fs')).createReadStream(f); res.on('close', () => st.destroy()); return st.pipe(res);
  }
  res.writeHead(404); res.end();
}).listen(PORT, '127.0.0.1', () => { console.log(`review harness: http://127.0.0.1:${PORT}/  (${ROOT})`); videoDrafts().forEach(ensureChanges); });
