/* Slop-o-meter: a brass ship's gauge on the Sloptrawler's cabin wall. The ship's log lists where AI was used, one row at
 * a time; each row kicks the needle up by its points (weight x level from rubric.json), the odometer rolls, the slop in
 * the trough rises, and the verdict is stamped at the end. Everything is a pure function of t, so any frame draws alone.
 *
 *   const m = SlopMeter.create(canvas, manifest, rubric);   // m.renderAt(t), m.DURATION, m.SCORE, m.VERDICT, m.ROWS
 *   const p = SlopMeter.player(m, { sound: true });         // p.play(), p.pause(), p.seek(t), p.onTick(fn)
 *
 * The same drawing as the slop-o-meter skill's player/meter.js (that one renders the mp4 card); this file adds a
 * Web Audio take on the skill's synthesised sound, so a page or a downloaded card can play it live. No dependencies.
 */
(function (root) {
  'use strict';
  const W = 1920, H = 1080;
  const SERIF = 'Georgia, "Times New Roman", serif', MONO = 'Consolas, "Courier New", monospace', STAMP = 'Impact, "Arial Black", sans-serif';
  const C = { ink: '#2a1a14', paper: '#f6ead2', pink: '#e8669a', deep: '#cc3f79', goo: '#8a5a30', gooDark: '#4e2f16', cream: '#fdf6f7', muted: '#6f5a55' };
  const ZONES = ['#6fae8c', '#a9c26a', '#e2c06a', '#e8669a', '#cc3f79', '#8a5a30'];

  const rnd = seed => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let x = Math.imul(seed ^ seed >>> 15, 1 | seed); x = x + Math.imul(x ^ x >>> 7, 61 | x) ^ x; return ((x ^ x >>> 14) >>> 0) / 4294967296; };
  const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
  const ease = x => { x = clamp(x); return 1 - Math.pow(1 - x, 3); };
  const back = x => { x = clamp(x); const s = 1.7; return 1 + (s + 1) * Math.pow(x - 1, 3) + s * Math.pow(x - 1, 2); };
  const fmt = p => (Math.abs(p - Math.round(p)) < 1e-6 ? String(Math.round(p)) : p.toFixed(1));

  /** The rubric for one manifest's kind of work (rubric.kinds; M.kind, default the first kind, "video"): its categories,
   *  plus those of any extras it ticked (M.extras), minus any it marked "doesn't apply" (M.na; never a kind's core
   *  one), with the weights scaled so they total 100. Video's weights are the base ones, so a manifest with no kind
   *  scores as it always did. A rubric without kinds, or one already worked out (it has .kind), comes back as it is. */
  function rubricFor(rubric, M = {}) {
    if (!rubric.kinds || rubric.kind) return rubric;
    const k = rubric.kinds.find(x => x.id === M.kind) || rubric.kinds[0];
    const base = Object.fromEntries(rubric.categories.map(c => [c.id, c]));
    let list = k.cats.slice();
    for (const e of k.extras || []) if ((M.extras || []).includes(e.id)) list = list.concat(e.cats);
    list = list.filter(o => o.core || !(M.na || []).includes(o.id));
    const total = list.reduce((s, o) => s + o.weight, 0);
    const categories = list.map(o => { const c = base[o.id], a = c.ask || {}, b = o.ask || {};
      return { ...c, weight: o.weight * 100 / total, raw: o.weight, core: !!o.core, label: o.label || c.label, short: o.short || c.short,
        ask: { q: b.q || a.q, sub: b.sub || a.sub, options: b.options || a.options } }; });
    const skipped = rubric.categories.map(c => c.id).filter(id => !categories.some(c => c.id === id));
    return { ...rubric, kind: k, categories, skipped };
  }

  /** Score a manifest without drawing it: rows (biggest first unless order:"manifest"), score, verdict, what went unused. */
  function score(M, rubric) {
    rubric = rubricFor(rubric, M);
    const cats = Object.fromEntries(rubric.categories.map(c => [c.id, c]));
    for (const u of M.uses) if (!cats[u.cat] && !(rubric.skipped || []).includes(u.cat)) throw new Error('unknown category ' + u.cat);
    const rows = M.uses.filter(u => u.level > 0 && cats[u.cat]).map(u => ({ ...u, c: cats[u.cat], pts: cats[u.cat].weight * u.level }));
    if (M.order !== 'manifest') rows.sort((a, b) => b.pts - a.pts || a.c.tier - b.c.tier);
    const used = new Set(rows.map(r => r.cat));
    const unused = rubric.categories.filter(c => !used.has(c.id) && c.tier <= (M.noneTier || 2));
    const SCORE = Math.round(rows.reduce((s, r) => s + r.pts, 0) * 10) / 10;
    const VERDICT = [...rubric.verdicts].reverse().find(v => SCORE >= v.min).text;
    return { rows, unused, SCORE, VERDICT, cats };
  }

  function create(cv, M, rubric) {
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    const { rows, unused: unusedCats, SCORE, VERDICT: verdict } = score(M, rubric);
    const unused = unusedCats.map(c => c.short);
    const PACE = M.pace || 0.85, T_IN = 1.0;
    rows.forEach((r, i) => { r.t = T_IN + i * PACE; r.kick = r.t + 0.32; });
    const tLast = rows.length ? rows[rows.length - 1].kick : T_IN;
    const T_FOOT = tLast + 0.7, T_STAMP = T_FOOT + 1.1, DURATION = T_STAMP + (M.hold || 3.2);
    const EVENTS = [{ t: 0.05, type: 'intro' }, ...rows.map(r => ({ t: r.t, type: 'row', pts: r.pts, kick: r.kick })),
      { t: T_FOOT, type: 'foot' }, { t: T_STAMP, type: 'stamp', pts: SCORE }];

    // needle: a sum of underdamped step responses, one per row (a real spring, but closed-form so any t renders alone)
    const ZETA = 0.32, OMEGA = 15;
    const stepResp = tau => { if (tau <= 0) return 0; const wd = OMEGA * Math.sqrt(1 - ZETA * ZETA);
      return 1 - Math.exp(-ZETA * OMEGA * tau) * (Math.cos(wd * tau) + ZETA / Math.sqrt(1 - ZETA * ZETA) * Math.sin(wd * tau)); };
    const needleAt = t => clamp(rows.reduce((s, r) => s + r.pts * stepResp(t - r.kick), 0) + 0.25 * Math.sin(t * 37) * Math.exp(-3 * Math.max(0, t - tLast)) * (t > T_IN ? 1 : 0), -1.5, 101.5);
    const countAt = t => rows.reduce((s, r) => s + r.pts * ease((t - r.kick) / 0.45), 0);   // the odometer rolls, it never bounces

    // ---- pre-baked layers ----
    const layer = (w, h, f) => { const c = document.createElement('canvas'); c.width = w; c.height = h; f(c.getContext('2d'), w, h); return c; };
    const wall = layer(W, H, (g) => {   // vertical cabin planks, grain, nails, one lamp upper-left
      const r = rnd(7);
      for (let x = 0; x < W;) { const pw = 120 + r() * 70, l = 18 + r() * 7;
        g.fillStyle = `hsl(${22 + r() * 6}, ${38 + r() * 10}%, ${l}%)`; g.fillRect(x, 0, pw, H);
        g.globalAlpha = 0.18; g.strokeStyle = '#120804'; g.lineWidth = 1.2;
        for (let k = 0; k < 14; k++) { const gx = x + 6 + r() * (pw - 12), amp = 2 + r() * 5, fr = 0.004 + r() * 0.01, ph = r() * 9;
          g.beginPath(); for (let y = 0; y <= H; y += 12) g.lineTo(gx + Math.sin(y * fr + ph) * amp, y); g.stroke(); }
        g.globalAlpha = 1; g.fillStyle = '#0d0603'; g.fillRect(x + pw - 3, 0, 3, H);
        for (const ny of [70 + r() * 30, H / 2 + r() * 40 - 20, H - 90 - r() * 30]) { g.fillStyle = '#0e0805'; g.beginPath(); g.arc(x + pw / 2, ny, 5, 0, 7); g.fill(); g.fillStyle = 'rgba(255,220,170,.25)'; g.beginPath(); g.arc(x + pw / 2 - 1.5, ny - 1.5, 2, 0, 7); g.fill(); }
        x += pw; }
      const lamp = g.createRadialGradient(330, -60, 40, 330, -60, 1500);
      lamp.addColorStop(0, 'rgba(255,200,120,.42)'); lamp.addColorStop(0.45, 'rgba(255,170,90,.12)'); lamp.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = lamp; g.fillRect(0, 0, W, H);
      const vig = g.createRadialGradient(W / 2, H / 2, 500, W / 2, H / 2, 1250); vig.addColorStop(0, 'rgba(0,0,0,0)'); vig.addColorStop(1, 'rgba(0,0,0,.72)');
      g.fillStyle = vig; g.fillRect(0, 0, W, H);
    });
    const CARD = { x: 60, y: 200, w: 1000, h: 770 };
    const paper = layer(CARD.w, CARD.h, (g, w, h) => {
      const r = rnd(3); g.fillStyle = C.paper; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 9000; i++) { g.fillStyle = `rgba(${r() < .5 ? '90,60,30' : '255,250,235'},${r() * .06})`; g.fillRect(r() * w, r() * h, 2, 2); }
      for (let i = 0; i < 3; i++) { const sx = r() * w, sy = r() * h, sr = 50 + r() * 60, st = g.createRadialGradient(sx, sy, sr * .6, sx, sy, sr);   // tea rings
        st.addColorStop(0, 'rgba(140,90,40,0)'); st.addColorStop(.9, 'rgba(140,90,40,.05)'); st.addColorStop(1, 'rgba(140,90,40,0)'); g.fillStyle = st; g.fillRect(0, 0, w, h); }
      const edge = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * .45, w / 2, h / 2, Math.max(w, h) * .75);
      edge.addColorStop(0, 'rgba(120,70,30,0)'); edge.addColorStop(1, 'rgba(120,70,30,.35)'); g.fillStyle = edge; g.fillRect(0, 0, w, h);
      g.strokeStyle = 'rgba(204,63,121,.35)'; g.lineWidth = 2; g.beginPath(); g.moveTo(88, 0); g.lineTo(88, h); g.stroke();   // log margin
      g.strokeStyle = 'rgba(80,110,160,.16)'; g.lineWidth = 1; for (let y = 150; y < h - 10; y += 32) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    });
    const GX = 1480, GY = 540, R = 340;
    const ang = v => (135 + 270 * clamp(v, -2, 102) / 100) * Math.PI / 180;
    const brass = (g, x0, y0, x1, y1) => { const b = g.createLinearGradient(x0, y0, x1, y1);
      b.addColorStop(0, '#fff1b8'); b.addColorStop(0.18, '#e0b45a'); b.addColorStop(0.45, '#8a5d1e'); b.addColorStop(0.62, '#c99a45'); b.addColorStop(0.85, '#6b4512'); b.addColorStop(1, '#3a250a'); return b; };
    const dial = layer(2 * R + 140, 2 * R + 140, (g, w, h) => {
      const cx = w / 2, cy = h / 2;
      g.save(); g.shadowColor = 'rgba(0,0,0,.65)'; g.shadowBlur = 40; g.shadowOffsetX = 18; g.shadowOffsetY = 24;
      g.fillStyle = brass(g, cx - R, cy - R, cx + R, cy + R); g.beginPath(); g.arc(cx, cy, R + 44, 0, 7); g.fill(); g.restore();
      g.fillStyle = brass(g, cx + R, cy + R, cx - R, cy - R); g.beginPath(); g.arc(cx, cy, R + 14, 0, 7); g.fill();
      const r = rnd(11);
      for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2 + 0.1, rx = cx + Math.cos(a) * (R + 29), ry = cy + Math.sin(a) * (R + 29);   // rivets
        g.fillStyle = brass(g, rx - 7, ry - 7, rx + 7, ry + 7); g.beginPath(); g.arc(rx, ry, 7, 0, 7); g.fill();
        g.strokeStyle = 'rgba(40,20,0,.6)'; g.lineWidth = 1; g.stroke(); }
      const face = g.createRadialGradient(cx - R * .3, cy - R * .35, 20, cx, cy, R);
      face.addColorStop(0, '#fffaf0'); face.addColorStop(0.7, '#f3e6cc'); face.addColorStop(1, '#d9c39a');
      g.fillStyle = face; g.beginPath(); g.arc(cx, cy, R, 0, 7); g.fill();
      for (let i = 0; i < 4000; i++) { g.fillStyle = `rgba(110,80,40,${r() * .05})`; const a = r() * 7, d = Math.sqrt(r()) * R; g.fillRect(cx + Math.cos(a) * d, cy + Math.sin(a) * d, 2, 2); }
      const bands = rubric.verdicts.map((v, i) => [v.min, rubric.verdicts[i + 1] ? rubric.verdicts[i + 1].min : 100]);   // zones follow the verdicts
      bands.forEach(([a, b], i) => { g.strokeStyle = ZONES[i % ZONES.length]; g.lineWidth = 34; g.beginPath(); g.arc(cx, cy, R * .84, ang(a), ang(b)); g.stroke(); });
      g.strokeStyle = C.ink; g.lineWidth = 2; g.beginPath(); g.arc(cx, cy, R * .84 + 17, ang(0), ang(100)); g.stroke();
      for (let v = 0; v <= 100; v += 2) { const major = v % 10 === 0, a = ang(v), r0 = R * .84 + 17, r1 = r0 - (major ? 50 : v % 5 === 0 ? 30 : 20);
        g.strokeStyle = C.ink; g.lineWidth = major ? 4 : 1.6; g.beginPath(); g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0); g.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); g.stroke();
        if (major) { g.fillStyle = C.ink; g.font = `bold 38px ${SERIF}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(v, cx + Math.cos(a) * R * .6, cy + Math.sin(a) * R * .6); } }
      g.fillStyle = C.ink; g.textAlign = 'center'; g.font = `bold 40px ${SERIF}`; g.fillText('SLOP-O-METER', cx, cy + R * .3);
      g.font = `19px ${MONO}`; g.fillStyle = C.muted; g.fillText('% OF ALL THE AI WE COULD HAVE USED', cx, cy + R * .67);
      g.font = `italic 21px ${SERIF}`; g.fillText('S.S. Sloptrawler · Est. 2026', cx, cy + R * .77);
    });
    const glass = layer(2 * R, 2 * R, (g, w, h) => {
      const gl = g.createLinearGradient(0, 0, w * .6, h * .7); gl.addColorStop(0, 'rgba(255,255,255,.32)'); gl.addColorStop(.5, 'rgba(255,255,255,.04)'); gl.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gl; g.beginPath(); g.arc(w / 2, h / 2, R - 2, Math.PI * .95, Math.PI * 1.75); g.arc(w / 2 - 40, h / 2 - 30, R * .78, Math.PI * 1.75, Math.PI * .95, true); g.fill();
    });

    // ---- drawing ----
    const fitFont = (text, max, size, min, fam, style = '') => { for (let s = size; s >= min; s--) { ctx.font = `${style} ${s}px ${fam}`; if (ctx.measureText(text).width <= max) return s; } return min; };
    const rrect = (x, y, w, h, r) => { ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h); };

    function drawPlate() {   // the brass name plate above the log
      const x = 70, y = 54, w = 980, h = 120;
      ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = 24; ctx.shadowOffsetX = 10; ctx.shadowOffsetY = 14;
      const pg = ctx.createLinearGradient(x, y, x + w, y + h * .5); [[0, '#c99a45'], [.12, '#fff1b8'], [.3, '#dcae58'], [.55, '#b0823a'], [.78, '#ecca7c'], [1, '#a8792f']].forEach(([o, c]) => pg.addColorStop(o, c)); ctx.fillStyle = pg; rrect(x, y, w, h, 14); ctx.fill(); ctx.restore();
      ctx.strokeStyle = 'rgba(60,30,0,.7)'; ctx.lineWidth = 3; rrect(x + 10, y + 10, w - 20, h - 20, 8); ctx.stroke();
      for (const [sx, sy] of [[x + 26, y + 26], [x + w - 26, y + 26], [x + 26, y + h - 26], [x + w - 26, y + h - 26]]) {
        ctx.fillStyle = brass(ctx, sx - 8, sy - 8, sx + 8, sy + 8); ctx.beginPath(); ctx.arc(sx, sy, 8, 0, 7); ctx.fill();
        ctx.strokeStyle = 'rgba(40,20,0,.8)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(sx - 6, sy - 2); ctx.lineTo(sx + 6, sy + 2); ctx.stroke(); }
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      fitFont(M.title, w - 120, 64, 34, SERIF, 'bold');
      ctx.fillStyle = 'rgba(255,240,190,.55)'; ctx.fillText(M.title, x + w / 2 + 2, y + h / 2 + 3);
      ctx.fillStyle = '#2a1608'; ctx.fillText(M.title, x + w / 2, y + h / 2);
    }

    function drawLog(t) {
      ctx.save(); ctx.translate(CARD.x, CARD.y); ctx.rotate(-0.006);
      ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.55)'; ctx.shadowBlur = 30; ctx.shadowOffsetX = 12; ctx.shadowOffsetY = 18; ctx.drawImage(paper, 0, 0); ctx.restore();
      ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
      ctx.fillStyle = C.ink; ctx.font = `italic 30px ${SERIF}`; ctx.fillText(M.byline || 'a sloptrawler music video', 110, 62);
      ctx.font = `bold 26px ${MONO}`; ctx.fillStyle = C.deep; ctx.fillText('WHERE THE AI WENT', 110, 112);
      ctx.textAlign = 'center'; ctx.fillStyle = C.muted; ctx.font = `20px ${MONO}`; ctx.fillText('HOW MUCH', 837, 112); ctx.fillText('PTS', 958, 112); ctx.textAlign = 'left';
      const top = 150, bottom = 640, rowH = Math.min(66, (bottom - top) / Math.max(1, rows.length));
      rows.forEach((r, i) => {
        const k = (t - r.t) / 0.3; if (k <= 0) return;
        const y = top + i * rowH + rowH / 2, dx = (1 - ease(k)) * -40;
        ctx.save(); ctx.globalAlpha = ease(k); ctx.translate(dx, 0);
        ctx.strokeStyle = C.ink; ctx.lineWidth = 2.5; ctx.strokeRect(108, y - 17, 34, 34);   // stamped check box
        const ck = (t - r.kick + 0.05) / 0.14;
        if (ck > 0) { const sc = 1 + (1 - ease(ck)) * 0.9; ctx.save(); ctx.translate(125, y); ctx.scale(sc, sc); ctx.rotate(-0.12);
          ctx.strokeStyle = C.deep; ctx.lineWidth = 7; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(-12, 0); ctx.lineTo(-3, 11); ctx.lineTo(16, -16); ctx.stroke(); ctx.restore(); }
        const n = Math.floor(r.text.length * clamp((t - r.t) / 0.4));   // typed text
        const fs = Math.min(Math.floor(rowH * .5), fitFont(r.text, 610, 30, 19, SERIF));
        ctx.font = `${fs}px ${SERIF}`; ctx.fillStyle = C.ink; ctx.fillText(r.text.slice(0, n), 160, y + fs * .34);
        for (let p = 0; p < 4; p++) { const px = 798 + p * 20; const on = r.level * 4 >= p + 1 - 1e-6;   // level pips
          ctx.fillStyle = on ? C.pink : 'rgba(0,0,0,0)'; ctx.strokeStyle = on ? C.deep : 'rgba(42,26,20,.45)'; ctx.lineWidth = 2;
          ctx.fillRect(px, y - 8, 15, 16); ctx.strokeRect(px, y - 8, 15, 16); }
        const pk = (t - r.kick) / 0.22;   // points chip
        if (pk > 0) { const sc = back(pk); ctx.save(); ctx.translate(958, y); ctx.scale(sc, sc);
          ctx.fillStyle = C.goo; rrect(-34, -18, 68, 36, 18); ctx.fill(); ctx.fillStyle = C.cream; ctx.font = `bold 22px ${MONO}`; ctx.textAlign = 'center';
          ctx.fillText('+' + fmt(r.pts), 0, 8); ctx.restore(); ctx.textAlign = 'left'; }
        ctx.restore();
      });
      const fk = (t - T_FOOT) / 0.4;   // footer: what AI didn't touch, and what the human did
      if (fk > 0) { ctx.save(); ctx.globalAlpha = ease(fk); let y = 676;
        ctx.strokeStyle = 'rgba(42,26,20,.5)'; ctx.setLineDash([6, 6]); ctx.beginPath(); ctx.moveTo(110, y - 30); ctx.lineTo(950, y - 30); ctx.stroke(); ctx.setLineDash([]);
        const line = (label, items, col) => { if (!items.length) return; ctx.font = `bold 22px ${MONO}`; ctx.fillStyle = col; ctx.fillText(label, 110, y);
          const txt = items.join(' · '); fitFont(txt, 950 - 250, 26, 17, SERIF, 'italic'); ctx.fillStyle = C.ink; ctx.fillText(txt, 250, y); y += 46; };
        line('NONE:', unused, '#3f7a5c'); line('BY HAND:', M.human || [], C.deep);
        ctx.restore(); }
      ctx.restore();
    }

    function drawGauge(t, v) {
      ctx.drawImage(dial, GX - dial.width / 2, GY - dial.height / 2);
      const cnt = Math.min(9999, Math.round(countAt(t) * 1000) / 100), ow = 44, oh = 64, NW = 4, ox = GX - ow * NW / 2, oy = GY + R * .38;   // odometer, in tenths
      ctx.fillStyle = '#1b100a'; rrect(ox - 10, oy - 8, ow * NW + 20, oh + 16, 8); ctx.fill();
      ctx.save(); rrect(ox, oy, ow * NW, oh, 4); ctx.clip();
      for (let d = 0; d < NW; d++) { const place = Math.pow(10, NW - 1 - d);   // carry: a wheel only turns while every wheel below rolls from 9 to 0
        const below = cnt % place; const pos = place === 1 ? cnt % 10 : Math.floor(cnt / place) % 10 + Math.max(0, below - (place - 1));
        const x = ox + d * ow, tenths = d === NW - 1; ctx.fillStyle = tenths ? C.deep : d % 2 ? '#f6ead2' : '#efe0c2'; ctx.fillRect(x + 1, oy, ow - 2, oh);
        ctx.fillStyle = tenths ? C.cream : C.ink; ctx.font = `bold 48px ${MONO}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        for (let k = -1; k <= 1; k++) { const dg = ((Math.floor(pos) + k) % 10 + 10) % 10; ctx.fillText(dg, x + ow / 2, oy + oh / 2 + (k - (pos - Math.floor(pos))) * oh + 2); } }
      const sh = ctx.createLinearGradient(0, oy, 0, oy + oh); sh.addColorStop(0, 'rgba(0,0,0,.55)'); sh.addColorStop(.3, 'rgba(0,0,0,0)'); sh.addColorStop(.7, 'rgba(0,0,0,0)'); sh.addColorStop(1, 'rgba(0,0,0,.55)');
      ctx.fillStyle = sh; ctx.fillRect(ox, oy, ow * NW, oh); ctx.restore();
      ctx.fillStyle = C.ink; ctx.beginPath(); ctx.arc(ox + ow * (NW - 1), oy + oh - 8, 4, 0, 7); ctx.fill();   // decimal point
      const a = ang(v);   // needle (shadow first, cast down-right away from the lamp)
      const needle = (dx, dy, shadow) => { ctx.save(); ctx.translate(GX + dx, GY + dy); ctx.rotate(a);
        ctx.beginPath(); ctx.moveTo(-R * .2, -9); ctx.lineTo(R * .74, -3); ctx.lineTo(R * .8, 0); ctx.lineTo(R * .74, 3); ctx.lineTo(-R * .2, 9); ctx.closePath();
        if (shadow) { ctx.fillStyle = 'rgba(40,20,0,.28)'; ctx.filter = 'blur(5px)'; ctx.fill(); ctx.restore(); return; }
        const ng = ctx.createLinearGradient(0, -9, 0, 9); ng.addColorStop(0, '#5a3a2a'); ng.addColorStop(.5, C.ink); ng.addColorStop(1, '#120a06'); ctx.fillStyle = ng; ctx.fill();
        ctx.fillStyle = C.pink; ctx.beginPath(); ctx.moveTo(R * .56, -4.5); ctx.lineTo(R * .74, -3); ctx.lineTo(R * .8, 0); ctx.lineTo(R * .74, 3); ctx.lineTo(R * .56, 4.5); ctx.closePath(); ctx.fill();
        ctx.fillStyle = C.ink; ctx.beginPath(); ctx.arc(-R * .17, 0, 17, 0, 7); ctx.fill(); ctx.restore(); };
      needle(10, 14, true); needle(0, 0, false);
      const sn = ctx.createRadialGradient(GX - 12, GY - 14, 4, GX, GY, 46); sn.addColorStop(0, '#ffd1de'); sn.addColorStop(.55, '#f2739c'); sn.addColorStop(1, '#b8406c');   // the pivot cap is Schnitzel's snout
      ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.45)'; ctx.shadowBlur = 12; ctx.shadowOffsetX = 5; ctx.shadowOffsetY = 7;
      ctx.fillStyle = sn; ctx.beginPath(); ctx.ellipse(GX, GY, 46, 36, 0, 0, 7); ctx.fill(); ctx.restore();
      ctx.fillStyle = '#5a1f33'; for (const s of [-1, 1]) { ctx.beginPath(); ctx.ellipse(GX + s * 15, GY + 2, 7, 12, s * 0.15, 0, 7); ctx.fill(); }
      ctx.drawImage(glass, GX - R, GY - R);
    }

    function drawTrough(t, v) {   // the slop at the bottom of the frame rises with the needle
      const level = H - (22 + Math.max(0, v) * 0.95);
      const g = ctx.createLinearGradient(0, level - 20, 0, H); g.addColorStop(0, '#a8703c'); g.addColorStop(.25, C.goo); g.addColorStop(1, C.gooDark);
      ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(0, H);
      const surf = x => level + Math.sin(x * .011 + t * 1.7) * 6 + Math.sin(x * .027 - t * 2.3) * 3.5 + Math.sin(x * .004 + t * .6) * 5;
      for (let x = 0; x <= W; x += 16) ctx.lineTo(x, surf(x)); ctx.lineTo(W, H); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(255,190,210,.35)'; ctx.lineWidth = 3; ctx.beginPath(); for (let x = 0; x <= W; x += 16) ctx.lineTo(x, surf(x) + 4); ctx.stroke();
      const r = rnd(21);
      for (let i = 0; i < 26; i++) { const bx = r() * W, per = 1.6 + r() * 2.4, ph = r() * per, life = ((t + ph) % per) / per, br = 4 + r() * 9;
        const y = H - 8 - life * (H - surf(bx) - 8);
        if (life < .92) { ctx.strokeStyle = 'rgba(255,220,180,.4)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(bx, y, br * (.6 + life * .5), 0, 7); ctx.stroke(); }
        else { const pk = (life - .92) / .08; ctx.strokeStyle = `rgba(255,220,180,${.5 * (1 - pk)})`; ctx.beginPath(); ctx.arc(bx, surf(bx), br * (1 + pk * 1.6), Math.PI, 0); ctx.stroke(); } }
    }

    const stampImg = layer(760, 260, (g, w, h) => {
      g.translate(w / 2, h / 2); g.strokeStyle = C.deep; g.fillStyle = C.deep;
      g.lineWidth = 9; g.strokeRect(-w / 2 + 10, -h / 2 + 10, w - 20, h - 20); g.lineWidth = 3; g.strokeRect(-w / 2 + 26, -h / 2 + 26, w - 52, h - 52);
      g.textAlign = 'center'; g.textBaseline = 'middle';
      let s = 96; do { g.font = `${s}px ${STAMP}`; s -= 2; } while (g.measureText(verdict).width > w - 90);
      g.fillText(verdict, 0, -22); g.font = `bold 36px ${MONO}`; g.fillText(`${fmt(SCORE)} / 100 POSSIBLE SLOP`, 0, 62);
      g.globalCompositeOperation = 'destination-out'; const r = rnd(5);   // rubber-stamp wear
      for (let i = 0; i < 2600; i++) { g.globalAlpha = r() * .8; g.fillRect(r() * w - w / 2, r() * h - h / 2, 1 + r() * 4, 1 + r() * 3); }
      for (let i = 0; i < 9; i++) { g.globalAlpha = .5; g.beginPath(); g.ellipse(r() * w - w / 2, r() * h - h / 2, 20 + r() * 50, 4 + r() * 8, r() * 3, 0, 7); g.fill(); }
    });

    function renderAt(t) {
      const v = needleAt(t);
      const sk = t - T_STAMP, shake = sk > 0 && sk < .35 ? (1 - sk / .35) * 9 : 0;
      ctx.save(); if (shake) ctx.translate(Math.sin(t * 90) * shake, Math.cos(t * 77) * shake * .6);
      ctx.drawImage(wall, 0, 0);
      drawGauge(t, v); drawLog(t); drawPlate();
      if (sk > 0) { const k = clamp(sk / .13), sc = 1 + (1 - k) * 1.3;
        ctx.save(); ctx.translate(GX + 10, GY + R * 1.02); ctx.rotate(-0.07); ctx.scale(sc * .86, sc * .86); ctx.globalAlpha = .3 + .65 * k;
        ctx.drawImage(stampImg, -stampImg.width / 2, -stampImg.height / 2); ctx.restore(); }
      drawTrough(t, v);
      ctx.restore();
    }

    renderAt(0);
    return { canvas: cv, renderAt, DURATION, EVENTS, SCORE, VERDICT: verdict,
      ROWS: rows.map(r => ({ cat: r.cat, label: r.c.label, level: r.level, pts: r.pts, text: r.text })), UNUSED: unusedCats.map(c => c.label) };
  }

  // ---- sound: the skill's sfx.py, live in Web Audio ----
  // Pass an OfflineAudioContext to render the sound into a buffer (the .mp4 export) instead of playing it.
  function Sound(offline) {
    const AC = root.AudioContext || root.webkitAudioContext;
    if (!AC && !offline) return null;
    // Every start() gets a fresh bus; stop() disconnects it, which silences whatever it had already scheduled.
    const ac = offline || new AC(), master = ac.createGain(); master.gain.value = 0.7; master.connect(ac.destination);
    let out = ac.createGain(); out.connect(master);
    const tap = ac.createMediaStreamDestination ? ac.createMediaStreamDestination() : null;   // for recording a .webm with sound
    if (tap) master.connect(tap);
    const noise = (() => { const b = ac.createBuffer(1, ac.sampleRate, ac.sampleRate), d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; return b; })();
    const env = (g, at, peak, a, dec) => { g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(peak, at + a); g.gain.exponentialRampToValueAtTime(0.0001, at + a + dec * 5); };
    const burst = (at, dur, peak, type, freq, q) => { const s = ac.createBufferSource(); s.buffer = noise; const f = ac.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q || 1;
      const g = ac.createGain(); env(g, at, peak, 0.0008, dur); s.connect(f).connect(g).connect(out); s.start(at, Math.random() * .5, dur * 6); };
    const tone = (at, freq, peak, dec, type) => { const o = ac.createOscillator(); o.type = type || 'sine'; o.frequency.value = freq; const g = ac.createGain(); env(g, at, peak, 0.002, dec); o.connect(g).connect(out); o.start(at); o.stop(at + dec * 6); };
    const S = {
      intro: at => { [210, 377, 612].forEach((f, i) => tone(at, f, .25 / (i + 1), .09)); burst(at, .02, .3, 'lowpass', 900); },
      clack: at => { burst(at, .008, .5, 'highpass', 2500); tone(at, 1800, .08, .012, 'square'); },
      click: (at, p) => { burst(at, .002, .35, 'bandpass', 3200 * p, 4); },
      scratch: at => { for (let i = 0; i < 10; i++) burst(at + i * .05, .02, .05, 'highpass', 4000); },
      stamp: at => { const o = ac.createOscillator(), g = ac.createGain(); o.frequency.setValueAtTime(100, at); o.frequency.exponentialRampToValueAtTime(60, at + .1); env(g, at, .9, .001, .16); o.connect(g).connect(out); o.start(at); o.stop(at + 1);
        burst(at, .03, .6, 'lowpass', 500);
        [[.5, .5, 2.6], [1, 1, 2.2], [1.19, .5, 1.4], [1.56, .35, 1.1], [2, .4, .9], [2.74, .25, .6]].forEach(([r, a, d]) => tone(at + .35, 740 * r, a * .12, d / 5)); }
    };
    return {
      ctx: ac, stream: tap && tap.stream,
      /** Schedule the meter's events from card time t0 onward. */
      start(m, t0) { this.stop(); out = ac.createGain(); out.connect(master); if (!offline && ac.state === 'suspended') ac.resume(); const base = ac.currentTime + (offline ? 0 : 0.03) - t0;
        for (const e of m.EVENTS) {
          if (e.type === 'intro' && e.t >= t0) S.intro(base + e.t);
          if (e.type === 'row') { if (e.t >= t0) S.clack(base + e.t); const n = Math.min(15, Math.round(e.pts)); for (let i = 0; i < n; i++) { const at = e.kick + i * Math.min(.03, .4 / n); if (at >= t0) S.click(base + at, 1 + i * .02); } }
          if (e.type === 'foot' && e.t >= t0) S.scratch(base + e.t);
          if (e.type === 'stamp' && e.t >= t0) S.stamp(base + e.t);
        } },
      stop() { out.disconnect(); }
    };
  }

  /** A play/pause/seek clock around a meter. Sound only starts from a user gesture (play()). */
  function player(m, opts = {}) {
    let playing = false, t = 0, start = 0, from = 0, raf = 0, snd = null, wantSound = !!opts.sound;
    const ticks = [];
    const draw = () => { m.renderAt(t); ticks.forEach(f => f(t, playing)); };
    const loop = () => { if (!playing) return; t = from + (performance.now() - start) / 1000;
      if (t >= m.DURATION) { t = m.DURATION; playing = false; draw(); if (opts.loop) { setTimeout(() => { p.seek(0); p.play(); }, 1200); } return; }
      draw(); raf = requestAnimationFrame(loop); };
    const p = {
      get t() { return t; }, get playing() { return playing; }, get sound() { return wantSound; },
      play() { if (t >= m.DURATION - .05) t = 0; playing = true; from = t; start = performance.now();
        if (wantSound) { snd = snd || Sound(); if (snd) snd.start(m, t); } cancelAnimationFrame(raf); raf = requestAnimationFrame(loop); draw(); },
      pause() { playing = false; cancelAnimationFrame(raf); if (snd) snd.stop(); draw(); },
      toggle() { playing ? p.pause() : p.play(); },
      seek(x) { t = clamp(x, 0, m.DURATION); if (playing) { from = t; start = performance.now(); if (snd && wantSound) snd.start(m, t); } draw(); },
      audioStream() { snd = snd || Sound(); return snd && snd.stream; },
      setSound(on) { wantSound = on; if (!on && snd) snd.stop(); else if (on && playing) { snd = snd || Sound(); if (snd) snd.start(m, t); } },
      onTick(f) { ticks.push(f); f(t, playing); }
    };
    return p;
  }

  root.SlopMeter = { create, player, score, rubricFor, Sound, fmt };
})(typeof window !== 'undefined' ? window : this);
