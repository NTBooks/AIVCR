/* The slop-o-meter generator. A short check, one question at a time: what kind of work it is (which decides the
 * questions and their weights, from rubric.json "kinds"), its name, then one question per category, then what was done
 * by hand. No score is shown while answering, so nobody nudges answers to land on a nicer number; "Reveal" plays the
 * card. The result hands over as a link (the log rides in its hash), an .mp4, a self-contained .html animation, a
 * .webm, a .png, description text or JSON. Nothing is sent anywhere; the draft is kept in this browser.
 * Where the other files are: data-rubric, data-core (meter-core.js) and data-mp4 (mp4-export.mjs) on the form, relative
 * to the page (form.mjs writes them). With data-slops, ?from=<slug> starts from <data-slops><slug>.json. */
(function () {
  'use strict';
  var form = document.querySelector('.gen-form'), cv = document.querySelector('.gen-canvas');
  if (!form || !cv || !window.SlopMeter) return;
  var P = form.dataset, rel = function (p) { return new URL(p, document.baseURI).href; };
  var outBox = document.querySelector('.gen-out'), ui = outBox.querySelector('.meter-ui'), btn = ui.querySelector('.m-play'),
    scrub = ui.querySelector('.m-scrub'), snd = ui.querySelector('.m-snd input');
  var out = document.querySelector('.gen-score'), statuses = document.querySelectorAll('.gen-status');
  var dlg = document.querySelector('.share-dlg'), reveal = document.querySelector('.reveal'), big = document.querySelector('.m-big');
  var head = { kicker: document.querySelector('.page-kicker'), h1: document.querySelector('.page-head h1'), lede: document.querySelector('.page-head .lede') };
  head.home = { h1: head.h1.textContent, lede: head.lede.textContent, title: document.title };
  var goBtn = document.querySelector('.gen-go'), viewing = false;
  var KEY = 'slop-o-meter-draft';
  var BASE = null, meter = null, player = null, recording = false;
  var LEVELS = [0, 0.25, 0.5, 0.75, 1];

  // ---- the answers (the form is rebuilt from these, one step at a time) ----
  var S = fresh();
  function fresh() { return { kind: null, extras: [], title: '', byline: '', url: '', human: '', answers: {}, notes: {}, edited: {} }; }

  function say(s) { put(s); clearTimeout(say.t); say.t = setTimeout(function () { put(''); }, 5000); }
  function put(s) { statuses.forEach(function (el) { el.textContent = s; }); }
  function safeUrl(u) {   // only http(s), so a shared link can't smuggle in a javascript: href
    u = (u || '').trim(); if (!u) return '';
    if (!/^[a-z][a-z0-9+.-]*:/i.test(u)) u = 'https://' + u;
    try { var x = new URL(u); return /^https?:$/.test(x.protocol) && x.hostname.indexOf('.') > 0 ? x.href : ''; } catch (e) { return ''; }
  }
  function fmt(p) { return SlopMeter.fmt(p); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  // ---- the rubric for one kind of work: its questions, weights scaled so they total 100 ----
  function kindOf(id) { return BASE.kinds.filter(function (k) { return k.id === id; })[0] || BASE.kinds[0]; }
  // Questions answered "doesn't apply" (na) drop out before scaling, so 0 and 100 stay reachable (meter-core.js rubricFor).
  function rubricFor(kindId, extras, na) { return SlopMeter.rubricFor(BASE, { kind: kindId, extras: extras, na: na }); }

  function naList() { return Object.keys(S.answers).filter(function (id) { return S.answers[id] === 'na'; }); }
  function questions() { return rubricFor(S.kind, S.extras, []); }   // every question, skipped or not
  function rubric() { return rubricFor(S.kind, S.extras, naList()); }   // what's scored

  // ---- answers <-> manifest (the manifest is what links, exports and the card use) ----
  function read() {
    var R = rubric(), uses = [];
    R.categories.forEach(function (c) {
      var lv = S.answers[c.id] || 0;
      if (lv > 0) uses.push({ cat: c.id, level: lv, text: (S.notes[c.id] || '').trim() || optionText(c, lv) });
    });
    var m = { kind: R.kind.id, title: S.title.trim() || R.kind.untitled, byline: S.byline.trim() || R.kind.byline, uses: uses,
      human: S.human.split(',').map(function (s) { return s.trim(); }).filter(Boolean) };
    if (S.extras.length) m.extras = S.extras.slice();
    var na = questions().categories.filter(function (c) { return S.answers[c.id] === 'na' && !c.core; }).map(function (c) { return c.id; });
    if (na.length) m.na = na;
    var url = safeUrl(S.url); if (url) m.url = url;
    return m;
  }
  function write(m) {   // a saved draft, a shared link or a ?from= file back into answers
    S = fresh();
    S.kind = m.kind && BASE.kinds.some(function (k) { return k.id === m.kind; }) ? m.kind : 'video';   // links from before kinds were all video
    S.extras = (m.extras || []).slice();
    S.title = (m.title || '').slice(0, 40); S.byline = (m.byline || '').slice(0, 40); S.url = safeUrl(m.url);
    S.human = (m.human || []).join(', ');
    questions().categories.forEach(function (c) {
      if (!c.core && (m.na || []).indexOf(c.id) >= 0) { S.answers[c.id] = 'na'; return; }
      var u = (m.uses || []).filter(function (x) { return x.cat === c.id; })[0], lv = u ? nearest(u.level) : 0;
      S.answers[c.id] = lv;
      if (u && u.text && u.text !== optionText(c, lv)) { S.notes[c.id] = u.text.slice(0, 52); S.edited[c.id] = true; }
    });
    if (m.edited) Object.keys(m.edited).forEach(function (id) { if (m.edited[id] && S.notes[id]) S.edited[id] = true; });
  }
  function nearest(lv) { return LEVELS.reduce(function (b, x) { return Math.abs(x - lv) < Math.abs(b - lv) ? x : b; }, 0); }
  function optionText(c, lv) { return c.ask.options[LEVELS.indexOf(nearest(lv))]; }
  function keep() { try { var m = read(); m.edited = S.edited; m.answered = Object.keys(S.answers); localStorage.setItem(KEY, JSON.stringify(m)); } catch (e) { /* private window */ } }

  // ---- the steps ----
  var steps = [], at = 0;
  var nav = { back: form.querySelector('[data-wiz="back"]'), next: form.querySelector('[data-wiz="next"]') };
  var bar = form.querySelector('.wiz-progress span'), count = form.querySelector('.wiz-count');
  function plan() {   // kind, name, one per question, by hand
    steps = [{ type: 'kind' }, { type: 'about' }];
    if (S.kind) questions().categories.forEach(function (c) { steps.push({ type: 'q', cat: c }); });
    steps.push({ type: 'hand' });
  }
  function go(i) {
    plan(); at = Math.max(0, Math.min(i, steps.length - 1));
    var st = steps[at];
    form.querySelectorAll('.wiz-step').forEach(function (el) { el.hidden = el.getAttribute('data-step') !== st.type; });
    var qs = steps.filter(function (s) { return s.type === 'q'; }), qi = qs.indexOf(st);
    count.textContent = st.type === 'q' ? 'Question ' + (qi + 1) + ' of ' + qs.length : st.type === 'hand' ? 'Last one' : 'Getting started';
    bar.style.width = (at / steps.length * 100) + '%';
    nav.back.hidden = at === 0;
    nav.next.textContent = st.type === 'hand' ? 'Reveal my score' : 'Next';
    nav.next.classList.toggle('reveal-btn', st.type === 'hand');
    if (st.type === 'kind') drawKinds();
    if (st.type === 'about') drawAbout();
    if (st.type === 'q') drawQuestion(st.cat);
    if (st.type === 'hand') form.elements.human.value = S.human;
    gate();
    var focus = form.querySelector('.wiz-step:not([hidden]) input:checked, .wiz-step:not([hidden]) input');
    if (focus && document.activeElement && form.contains(document.activeElement)) focus.focus({ preventScroll: true });
  }
  function gate() {   // Next waits for an answer on the steps that need one
    var st = steps[at], ok = st.type === 'kind' ? !!S.kind : st.type === 'q' ? S.answers[st.cat.id] !== undefined : true;
    nav.next.disabled = !ok;
  }

  function drawKinds() {
    var box = form.querySelector('.wiz-kinds');
    box.innerHTML = BASE.kinds.map(function (k) {
      return '<label class="wiz-card"><input type="radio" name="kind" value="' + k.id + '"' + (S.kind === k.id ? ' checked' : '') + '>' +
        '<span><b>' + esc(k.label) + '</b><small>' + esc(k.blurb) + '</small></span></label>';
    }).join('');
    drawExtras();
  }
  function drawExtras() {
    var k = S.kind && kindOf(S.kind), box = form.querySelector('.wiz-extras');
    box.hidden = !(k && k.extras && k.extras.length);
    if (box.hidden) return;
    box.innerHTML = '<p class="wiz-sub">Does it also have…</p>' + k.extras.map(function (e) {
      return '<label class="wiz-check"><input type="checkbox" name="extra" value="' + e.id + '"' + (S.extras.indexOf(e.id) >= 0 ? ' checked' : '') + '><span>' + esc(e.label) + '</span></label>';
    }).join('');
  }
  function drawAbout() {
    var f = form.elements, k = kindOf(S.kind);
    f.title.value = S.title; f.byline.value = S.byline; f.url.value = S.url;
    f.title.placeholder = k.untitled; f.byline.placeholder = k.byline; f.url.placeholder = k.link;
  }
  function drawQuestion(c) {
    var step = form.querySelector('[data-step="q"]');
    step.querySelector('.wiz-q-h').textContent = c.ask.q;
    step.querySelector('.wiz-q-sub').textContent = c.ask.sub || '';
    var box = step.querySelector('.wiz-opts'), cur = S.answers[c.id];
    box.setAttribute('aria-label', c.ask.q);
    box.innerHTML = c.ask.options.map(function (o, i) {
      return '<label class="wiz-opt"><input type="radio" name="lv" value="' + LEVELS[i] + '"' + (cur === LEVELS[i] ? ' checked' : '') + '><span>' + esc(o) + '</span></label>';
    }).join('') + (c.core ? '' : '<label class="wiz-opt wiz-na"><input type="radio" name="lv" value="na"' + (cur === 'na' ? ' checked' : '') + '><span>' + esc(BASE.na) + '</span></label>');
    drawNote(c);
  }
  function drawNote(c) {
    var lv = S.answers[c.id], wrap = form.querySelector('.wiz-note'), input = form.elements.note;
    wrap.hidden = !(lv > 0);
    if (lv > 0) {
      if (!S.edited[c.id]) S.notes[c.id] = optionText(c, lv);   // follows the answer until you write your own
      input.value = S.notes[c.id];
    }
  }

  form.addEventListener('change', function (e) {
    var t = e.target, st = steps[at];
    if (t.name === 'kind') {
      S.kind = t.value;
      S.extras = S.extras.filter(function (x) { return (kindOf(S.kind).extras || []).some(function (e) { return e.id === x; }); });
      drawExtras();
    }
    if (t.name === 'extra') S.extras = [].slice.call(form.querySelectorAll('input[name="extra"]:checked')).map(function (x) { return x.value; });
    if (t.name === 'lv') { S.answers[st.cat.id] = t.value === 'na' ? 'na' : +t.value; drawNote(st.cat); }
    gate(); edited(); keep();
  });
  form.addEventListener('input', function (e) {
    var t = e.target, st = steps[at];
    if (t.name === 'title' || t.name === 'byline' || t.name === 'url' || t.name === 'human') S[t.name] = t.value;
    if (t.name === 'note') { S.notes[st.cat.id] = t.value; S.edited[st.cat.id] = t.value.trim() !== ''; }   // emptied: it follows the answer again
    edited(); keep();
  });
  function edited() {   // editing makes it yours: drop a shared link from the address bar so a reload keeps the edits
    if (location.hash) history.replaceState(null, '', location.pathname + location.search);
    if (viewing) leaveShared();
  }
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (nav.next.disabled) return say('Pick an answer to carry on.');
    if (steps[at].type === 'hand') return showtime();
    go(at + 1);
    form.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });
  nav.back.addEventListener('click', function () { go(at - 1); });
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-wiz]'), w = b && b.getAttribute('data-wiz');
    if (w === 'edit') { showForm(); go(2); }
    if (w === 'restart' && viewing) { edited(); S = fresh(); loadDraft(); showForm(); go(0); return; }   // their own draft, untouched
    if (w === 'restart') { S = fresh(); try { localStorage.removeItem(KEY); } catch (er) { /* none */ } edited(); showForm(); go(0); }
  });
  function showForm() {
    if (player) player.pause();
    outBox.hidden = true; form.hidden = false;
    form.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  // ---- the card ----
  btn.addEventListener('click', function () { player.setSound(snd.checked); player.toggle(); });
  snd.addEventListener('change', function () { player.setSound(snd.checked); });
  scrub.addEventListener('input', function () { player.pause(); player.seek(scrub.value / 1000 * meter.DURATION); });
  cv.addEventListener('click', function () { btn.click(); });

  function build(sound) {
    if (player) player.pause();
    meter = SlopMeter.create(cv, read(), rubric());
    player = SlopMeter.player(meter, { sound: sound });
    out.classList.remove('on'); out.innerHTML = '';
    player.onTick(function (t, on) {
      scrub.value = Math.round(t / meter.DURATION * 1000);
      btn.textContent = on ? 'Pause' : (t >= meter.DURATION - 0.05 ? 'Replay' : 'Play');
      if (on) big.hidden = true;
      if (t >= meter.DURATION - 0.05 && !out.classList.contains('on')) {   // the number lands once the stamp has
        out.innerHTML = '<b>' + fmt(meter.SCORE) + '</b> / 100 &middot; ' + esc(meter.VERDICT);
        out.classList.add('on');
      }
    });
  }
  function showResult(autoplay) {
    form.hidden = true; outBox.hidden = false;
    if (autoplay) { player.seek(0); player.play(); } else player.seek(meter.DURATION);
  }

  // ---- the reveal: a drum roll, then the card plays ----
  function showtime() {
    keep();
    build(snd.checked);
    if (snd.checked) player.audioStream();   // make the sound now, inside the click, so the browser lets it play later
    var R = rubric(), lines = ['Weighing the slop…'].concat(R.categories.filter(function (c) { return S.answers[c.id] > 0; })
      .map(function (c) { return 'Sniffing out the ' + c.short.replace(/^AI /, '') + '…'; })).concat(['Checking the trough…', 'Here it comes…']);
    var quick = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    var dur = quick ? 600 : 2800, odo = reveal.querySelectorAll('.reveal-odo span'), sayEl = reveal.querySelector('.reveal-say');
    reveal.hidden = false; reveal.classList.remove('boom', 'done');
    void reveal.offsetWidth;   // restart the CSS animations
    reveal.classList.add('on');
    var t0 = performance.now(), li = -1;
    (function spin() {
      var k = (performance.now() - t0) / dur;
      if (k >= 1) return land();
      odo.forEach(function (d) { d.textContent = Math.floor(Math.random() * 10); });
      var n = Math.min(lines.length - 1, Math.floor(k * lines.length));
      if (n !== li) { li = n; sayEl.textContent = lines[n]; }
      setTimeout(function () { requestAnimationFrame(spin); }, 40 + k * 90);   // the digits slow down as it closes in
    })();
    function land() {
      reveal.classList.add('boom');
      form.hidden = true; outBox.hidden = false; player.seek(0);   // not showResult(): seeking to the end would land the number early
      outBox.scrollIntoView({ block: 'center' });
      setTimeout(function () { reveal.classList.add('done'); player.play(); }, quick ? 50 : 350);
      setTimeout(function () { reveal.hidden = true; reveal.classList.remove('on', 'boom', 'done'); }, quick ? 100 : 900);
    }
  }

  function load(url) {
    return fetch(url).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (m) { delete m.draft; write(m); go(2); say('Loaded "' + m.title + '". Change anything; it\'s yours now.'); })
      .catch(function () { say('Couldn\'t load that one.'); go(0); });
  }

  // ---- the hand-offs ----
  function slug() { return (read().title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'slop') + '-slop-o-meter'; }
  function save(blob, name) { var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000); }
  function copy(text, what) { (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(function () { say(what + ' copied.'); }, function () { window.prompt('Copy this:', text); }); }
  function json(x) { return JSON.stringify(x).replace(/</g, '\\u003c'); }
  // ---- share links: the whole log rides in the #hash (never sent to a server), kept short and readable ----
  //   #k=music&a=4n0132&t=Night+Bus+Home&b=a+lo-fi+track&u=youtu.be/x&h=the+idea,the+mix&n3=My+own+words
  // k kind · x extras (comma list) · a one character per rubric category, in rubric.json order: 0-4 the answer, n doesn't
  // apply, - not asked (trailing - dropped) · t title · b byline (left out when it's the kind's default) · u link without
  // https:// · h by hand · n<i> card text for category i, only when it isn't the answer's own wording.
  // rubric.json "categories" must only ever be appended to, never reordered, or old links would read wrong.
  // Links made before this (#m=<base64 JSON>) still open.
  function q(s) { return encodeURIComponent(s).replace(/%20/g, '+').replace(/%2C/g, ',').replace(/%2F/g, '/').replace(/%3A/g, ':').replace(/%40/g, '@').replace(/%3F/g, '?').replace(/%3D/g, '='); }
  function encodeShare(m) {
    var R = rubricFor(m.kind, m.extras, []), asked = {}, p = ['k=' + m.kind];
    R.categories.forEach(function (c) { asked[c.id] = c; });
    if (m.extras && m.extras.length) p.push('x=' + m.extras.join(','));
    var a = BASE.categories.map(function (c) {
      if (!asked[c.id]) return '-';
      if ((m.na || []).indexOf(c.id) >= 0 && !asked[c.id].core) return 'n';
      var u = m.uses.filter(function (x) { return x.cat === c.id; })[0];
      return String(u ? LEVELS.indexOf(nearest(u.level)) : 0);
    }).join('').replace(/-+$/, '');
    p.push('a=' + a);
    if (m.title && m.title !== R.kind.untitled) p.push('t=' + q(m.title));
    if (m.byline && m.byline !== R.kind.byline) p.push('b=' + q(m.byline));
    if (m.url) p.push('u=' + q(m.url.replace(/^https:\/\//, '')));
    if (m.human && m.human.length) p.push('h=' + q(m.human.join(',')));
    BASE.categories.forEach(function (c, i) {
      var u = m.uses.filter(function (x) { return x.cat === c.id; })[0];
      if (u && asked[c.id] && u.text && u.text !== optionText(asked[c.id], u.level)) p.push('n' + i + '=' + q(u.text));
    });
    return p.join('&');
  }
  function decodeShare(hash) {   // -> a manifest, or null if this hash isn't a share link
    var h = hash.replace(/^#/, '');
    if (/^m=/.test(h)) return JSON.parse(decodeURIComponent(escape(atob(decodeURIComponent(h.slice(2))))));   // the old long links
    var p = new URLSearchParams(h); if (!p.has('a')) return null;
    var k = kindOf(p.get('k')), extras = (p.get('x') || '').split(',').filter(Boolean), a = p.get('a');
    var m = { kind: k.id, extras: extras, title: p.get('t') || '', byline: p.get('b') || '', url: p.get('u') || '', uses: [], na: [],
      human: (p.get('h') || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean) };
    BASE.categories.forEach(function (c, i) {
      var ch = a.charAt(i);
      if (ch === 'n') m.na.push(c.id);
      else if (/[1-4]/.test(ch)) m.uses.push({ cat: c.id, level: LEVELS[+ch], text: p.get('n' + i) || '' });
    });
    return m;
  }
  function link() { return location.origin + location.pathname + '#' + encodeShare(read()); }
  function blurb() { var m = read(), s = SlopMeter.score(m, rubric()); return m.title + ' scores ' + fmt(s.SCORE) + '/100 on the slop-o-meter (' + s.VERDICT.toLowerCase() + '). Here\'s where the AI went:'; }
  function share() {   // fill the dialog for the log as it stands now
    var u = link(), t = blurb(), e = encodeURIComponent;
    dlg.querySelector('.share-url').value = u;
    var to = { x: 'https://x.com/intent/post?text=' + e(t) + '&url=' + e(u), bsky: 'https://bsky.app/intent/compose?text=' + e(t + ' ' + u),
      reddit: 'https://www.reddit.com/submit?url=' + e(u) + '&title=' + e(t), facebook: 'https://www.facebook.com/sharer/sharer.php?u=' + e(u),
      linkedin: 'https://www.linkedin.com/sharing/share-offsite/?url=' + e(u), email: 'mailto:?subject=' + e(read().title + ': slop-o-meter') + '&body=' + e(t + '\n\n' + u) };
    dlg.querySelectorAll('[data-to]').forEach(function (a) { a.href = to[a.getAttribute('data-to')]; });
    dlg.querySelector('.share-native').hidden = !navigator.share;
    if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
    dlg.querySelector('.share-url').select();
  }
  function describe() {
    var m = read(), R = rubric(), s = SlopMeter.score(m, R), lines = ['Slop-o-meter: ' + fmt(s.SCORE) + '/100 (' + s.VERDICT.toLowerCase().replace(/\b\w/g, function (c) { return c.toUpperCase(); }) + '). Where the AI went:'];
    s.rows.forEach(function (r) { lines.push('- ' + r.text + ' (+' + fmt(r.pts) + ')'); });
    if (s.unused.length) lines.push('None: ' + s.unused.map(function (c) { return c.short; }).join(', ') + '.');
    var skipped = questions().categories.filter(function (c) { return (m.na || []).indexOf(c.id) >= 0; });
    if (skipped.length) lines.push('Doesn\'t apply: ' + skipped.map(function (c) { return c.label.toLowerCase(); }).join(', ') + '.');
    if (m.human.length) lines.push('By hand: ' + m.human.join(', ') + '.');
    if (m.url) lines.push('See it: ' + m.url);
    lines.push('(Scored out of 100: all the AI ' + R.kind.byline + ' could have used. Make your own at https://slopscore.org/slop-o-meter/)');
    return lines.join('\n');
  }
  var ACT = {
    html: function () {
      fetch(rel(P.core || '../player/meter-core.js')).then(function (r) { return r.text(); }).then(function (core) {
        var m = read();
        var page = '<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">\n' +
          '<title>Slop-o-meter: ' + m.title.replace(/[<&]/g, '') + '</title>\n' +
          '<style>html,body{margin:0;background:#120b08;color:#fdf6f7;font:14px system-ui,sans-serif}canvas{display:block;width:100%;max-width:1920px;aspect-ratio:16/9;margin:0 auto;cursor:pointer}' +
          '#ui{display:flex;gap:12px;align-items:center;max-width:1920px;margin:8px auto;padding:0 12px;box-sizing:border-box}#ui input[type=range]{flex:1}' +
          'button{font:inherit;padding:4px 14px}body.bare #ui{display:none}a{color:#e8669a}</style></head><body>\n' +
          '<canvas id="c" width="1920" height="1080"></canvas>\n<div id="ui"><button id="p">Play</button><input id="s" type="range" min="0" max="1000" value="0" aria-label="Scrub">' +
          '<label><input id="snd" type="checkbox" checked> sound</label>' + (m.url ? '<a href="' + m.url.replace(/"/g, '%22').replace(/</g, '%3C') + '" rel="noopener">see the work</a>' : '') +
          '<a href="https://slopscore.org/slop-o-meter/">make your own</a></div>\n' +
          '<!-- Slop-o-meter by slopscore.org. ?bare hides the controls, ?loop loops, ?autoplay plays silently on load. window.renderAt(t) draws any moment; window.DURATION is the length. -->\n' +
          '<script>\n' + core + '\n</script>\n<script>\n(function(){var q=new URLSearchParams(location.search),RUBRIC=' + json(rubric()) + ',SLOP=' + json(m) + ';\n' +
          'var m=SlopMeter.create(document.getElementById("c"),SLOP,RUBRIC),p=SlopMeter.player(m,{sound:false,loop:q.has("loop")});\n' +
          'window.renderAt=m.renderAt;window.DURATION=m.DURATION;window.SCORE=m.SCORE;window.VERDICT=m.VERDICT;window.EVENTS=m.EVENTS;window.__ready=true;\n' +
          'if(q.has("bare"))document.body.classList.add("bare");var b=document.getElementById("p"),s=document.getElementById("s"),snd=document.getElementById("snd");\n' +
          'b.onclick=function(){p.setSound(snd.checked);p.toggle()};snd.onchange=function(){p.setSound(snd.checked)};document.getElementById("c").onclick=function(){b.click()};\n' +
          's.oninput=function(){p.pause();p.seek(s.value/1000*m.DURATION)};p.onTick(function(t,on){s.value=Math.round(t/m.DURATION*1000);b.textContent=on?"Pause":"Play"});\n' +
          'if(q.has("autoplay")||q.has("loop"))p.play();})();\n</script>\n</body></html>\n';
        save(new Blob([page], { type: 'text/html' }), slug() + '.html'); say('Saved. Open it in any browser; it needs no internet.');
      });
    },
    webm: function () {
      if (recording) return;
      if (!window.MediaRecorder || !cv.captureStream) return say('This browser can\'t record video. Try Chrome or Firefox, or use the .html.');
      var stream = cv.captureStream(30), audio = player.audioStream();
      if (audio && snd.checked) audio.getAudioTracks().forEach(function (t) { stream.addTrack(t); });
      var type = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].filter(function (t) { return MediaRecorder.isTypeSupported(t); })[0];
      var rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 12e6 }), chunks = [];
      rec.ondataavailable = function (e) { if (e.data.size) chunks.push(e.data); };
      rec.onstop = function () { recording = false; save(new Blob(chunks, { type: 'video/webm' }), slug() + '.webm'); say('Saved the video.'); };
      recording = true; say('Recording in real time: ' + Math.ceil(meter.DURATION) + ' seconds. Keep this tab in front.');
      player.pause(); player.seek(0); player.setSound(snd.checked); rec.start(); player.play();
      var watch = setInterval(function () { if (!player.playing) { clearInterval(watch); setTimeout(function () { rec.stop(); }, 400); } }, 100);
    },
    mp4: function () {
      if (recording) return;
      recording = true; player.pause(); say('Making the .mp4…');
      var fps = 30, dur = meter.DURATION + 0.5, rate = 48000;
      var off = snd.checked && window.OfflineAudioContext ? new OfflineAudioContext(2, Math.ceil(dur * rate), rate) : null;
      var sound = off && SlopMeter.Sound(off);
      if (sound) sound.start(meter, 0);
      Promise.all([import(rel(P.mp4 || './mp4-export.mjs')), off ? off.startRendering() : null]).then(function (r) {
        return r[0].exportMp4({ canvas: cv, width: cv.width, height: cv.height, fps: fps, duration: dur, audio: r[1],
          renderFrame: function (t) { meter.renderAt(Math.min(t, meter.DURATION)); },
          onProgress: function (f) { put('Making the .mp4: ' + Math.round(f * 100) + '%'); } });
      }).then(function (blob) { save(blob, slug() + '.mp4'); say('Saved the .mp4.'); }, function (e) { say(e.message || 'Couldn\'t make the .mp4.'); })
        .then(function () { recording = false; player.seek(player.t); });
    },
    png: function () { player.pause(); player.seek(meter.DURATION); cv.toBlob(function (b) { save(b, slug() + '.png'); }); },
    desc: function () { copy(describe(), 'Description text'); },
    json: function () { copy(JSON.stringify(read(), null, 1), 'JSON'); },
    link: function () { copy(link(), 'Link'); },
    share: share,
    native: function () { navigator.share({ title: read().title + ': slop-o-meter', text: blurb(), url: link() }).catch(function () { /* cancelled */ }); },
    close: function () { if (dlg.close) dlg.close(); else dlg.removeAttribute('open'); }
  };
  [document.querySelector('.gen-actions'), dlg].forEach(function (el) {
    el.addEventListener('click', function (e) { var b = e.target.closest('[data-act]'); if (b) ACT[b.getAttribute('data-act')](); });
  });
  dlg.addEventListener('click', function (e) { if (e.target === dlg) ACT.close(); });   // a click on the backdrop
  // ---- opened from somebody's link: the page is about their work, not yours ----
  function enterShared() {
    var m = read();
    viewing = true; document.body.classList.add('shared-view');
    head.kicker.hidden = false; head.h1.textContent = m.title;
    var by = m.byline ? m.byline.charAt(0).toUpperCase() + m.byline.slice(1) + '. ' : '';
    head.lede.textContent = by + 'Somebody shared this to show how much AI went into it. Press play to find out.';
    document.title = m.title + ': slop-o-meter';
    goBtn.hidden = !m.url;
    if (m.url) { goBtn.href = m.url; goBtn.textContent = 'Go to the work (' + new URL(m.url).hostname.replace(/^www\./, '') + ')'; }
    build(true); form.hidden = true; outBox.hidden = false; player.seek(0);   // the score waits for the stamp, as in a reveal
    big.hidden = false;
  }
  function leaveShared() {
    viewing = false; document.body.classList.remove('shared-view');
    head.kicker.hidden = true; head.h1.textContent = head.home.h1; head.lede.textContent = head.home.lede; document.title = head.home.title;
    goBtn.hidden = true; big.hidden = true;
  }
  big.addEventListener('click', function () { big.hidden = true; player.setSound(snd.checked); player.seek(0); player.play(); });


  // ---- "How the score works", drawn from the rubric so it always matches the real weights ----
  function explain() {
    var body = document.querySelector('.how-body'); if (!body) return;
    var html = '<p>First you pick what kind of work it is. That decides which questions you get, and how much each one counts. ' +
      'Each kind adds up to 100: the most AI that kind of work could use. Your answer to each question takes a share of its points:</p>' +
      '<table class="rubric levels"><tbody>' + ['The first answer (no AI)', 'The second answer', 'The middle answer', 'The fourth answer', 'The last answer (all AI)']
        .map(function (a, i) { return '<tr><td>' + a + '</td><td>' + (LEVELS[i] * 100) + '%</td></tr>'; }).join('') + '</tbody></table>' +
      '<p>The score is the total. So a song whose music was all AI-generated (40 points) but whose lyrics you wrote yourself (0 of 30) scores 40 before the smaller questions.</p>' +
      '<p>Most questions also have a “' + esc(BASE.na) + '” answer, for an instrumental with no lyrics, say. Those questions are left out, and the rest are scaled up so they still add up to 100: ' +
      'all AI is always 100 and no AI is always 0. The main question for each kind of work (marked ★) can\'t be skipped.</p>';
    BASE.kinds.forEach(function (k) {
      var R = rubricFor(k.id, []);
      html += '<h3>' + esc(k.label) + '</h3><table class="rubric"><thead><tr><th>Question</th><th>Points</th></tr></thead><tbody>' +
        R.categories.map(function (c) { return '<tr><td>' + (c.core ? '★ ' : '') + esc(c.ask.q) +(c.ask.sub ? '<small>' + esc(c.ask.sub) + '</small>' : '') + '</td><td>' + fmt(c.weight) + '</td></tr>'; }).join('');
      (k.extras || []).forEach(function (e) {
        var R2 = rubricFor(k.id, [e.id]);
        html += R2.categories.filter(function (c) { return !k.cats.some(function (b) { return b.id === c.id; }); }).map(function (c) {
          return '<tr class="extra"><td>' + esc(c.ask.q) + '<small>Only if “' + esc(e.label.replace(/^It has /, 'it has ')) + '” is ticked</small></td><td>+' + fmt(c.raw) + '</td></tr>';
        }).join('');
      });
      html += '</tbody></table>';
      if (k.extras) html += '<p class="small">Ticking an extra adds its questions, then every weight is scaled back down so the total is still 100.</p>';
    });
    html += '<p>Verdicts: ' + BASE.verdicts.map(function (v, i) {
      var z = ['#6fae8c', '#a9c26a', '#e2c06a', '#e8669a', '#cc3f79', '#8a5a30'][i];
      return '<span class="verdict-tag" style="--z:' + z + '">' + v.min + '+ ' + esc(v.text) + '</span>';
    }).join(' ') + '</p>';
    body.innerHTML = html;
  }

  function loadDraft() {   // this browser's last check, if there is one
    var saved = null; try { saved = JSON.parse(localStorage.getItem(KEY)); } catch (e) { /* none */ }
    // The old one-page form saved its sample log ("My Video", "a music video"…) for everyone, even untouched; that's not a draft
    // (and a draft started on top of it carries that sample name along, so drop the name wherever it turns up)
    if (saved && saved.title === 'My Video' && saved.byline === 'a music video') {
      if (!saved.kind) saved = null; else { delete saved.title; delete saved.byline; }
    }
    if (saved && saved.uses) {
      write(saved);
      // answers never given stay unanswered, so a half-finished check picks up where it left off
      var R = rubric(), answered = saved.answered;
      if (answered) R.categories.forEach(function (c) { if (answered.indexOf(c.id) < 0) delete S.answers[c.id]; });
    }
  }

  // ---- start: a shared link, ?from=, the last draft, or a blank check ----
  fetch(rel(P.rubric || '../rubric.json')).then(function (r) { return r.json(); }).then(function (r) {
    BASE = r; explain();
    var from = new URLSearchParams(location.search).get('from'), sm = null;
    if (location.hash.length > 1) { try { sm = decodeShare(location.hash); } catch (e) { say('That link didn\'t decode.'); } }
    // a share link pasted into a tab that already has this page open only changes the #hash, which doesn't reload
    addEventListener('hashchange', function () {
      var m2 = null; try { m2 = decodeShare(location.hash); } catch (e) { return say('That link didn\'t decode.'); }
      if (m2) { if (dlg.open) ACT.close(); reveal.hidden = true; write(m2); go(2); enterShared(); scrollTo(0, 0); }
    });
    if (sm) { write(sm); go(2); return enterShared(); }
    if (from && P.slops && /^[a-z0-9-]+$/.test(from)) return load(rel(P.slops + from + '.json'));
    loadDraft();
    go(0);
  });
})();
