/* The slop-o-meter generator: the form is the manifest. Every change rebuilds the card live; the actions hand it over as
 * a self-contained animation (.html: the meter code, the rubric and your log in one file, no network), a recorded
 * .webm with the sound, the final frame as a .png, the description text, the JSON, or a link that carries the log in
 * its hash (opened, it shows the meter and a button on to the work). Nothing is sent anywhere; the last draft is kept in
 * this browser so a reload doesn't lose it.
 * Where the other files are: data-rubric, data-core (meter-core.js) and data-mp4 (mp4-export.mjs) on the form, relative
 * to the page (form.mjs writes them). With data-slops, ?from=<slug> starts from <data-slops><slug>.json. */
(function () {
  'use strict';
  var form = document.querySelector('.gen-form'), cv = document.querySelector('.gen-canvas');
  if (!form || !cv || !window.SlopMeter) return;
  var P = form.dataset, at = function (p) { return new URL(p, document.baseURI).href; };
  var ui = document.querySelector('.gen-out .meter-ui'), btn = ui.querySelector('.m-play'), scrub = ui.querySelector('.m-scrub'), snd = ui.querySelector('.m-snd input');
  var out = document.querySelector('.gen-score'), statuses = document.querySelectorAll('.gen-status');
  var dlg = document.querySelector('.share-dlg'), shared = document.querySelector('.gen-shared');
  var KEY = 'slop-o-meter-draft';
  var RUBRIC = null, meter = null, player = null, timer = null, recording = false;

  function say(s) { put(s); clearTimeout(say.t); say.t = setTimeout(function () { put(''); }, 5000); }
  function put(s) { statuses.forEach(function (el) { el.textContent = s; }); }
  function safeUrl(u) {   // only http(s), so a shared link can't smuggle in a javascript: href
    u = (u || '').trim(); if (!u) return '';
    if (!/^[a-z][a-z0-9+.-]*:/i.test(u)) u = 'https://' + u;
    try { var x = new URL(u); return /^https?:$/.test(x.protocol) && x.hostname.indexOf('.') > 0 ? x.href : ''; } catch (e) { return ''; }
  }
  function fmt(p) { return SlopMeter.fmt(p); }

  // ---- form <-> manifest ----
  function read() {
    var f = form.elements, uses = [];
    RUBRIC.categories.forEach(function (c) {
      var lv = +(form.querySelector('input[name="lv-' + c.id + '"]:checked') || { value: 0 }).value, tx = f['tx-' + c.id].value.trim();
      if (lv > 0) uses.push({ cat: c.id, level: lv, text: tx || c.label });
    });
    var m = { title: f.title.value.trim() || 'Untitled', byline: f.byline.value.trim() || 'a video', uses: uses,
      human: f.human.value.split(',').map(function (s) { return s.trim(); }).filter(Boolean) };
    var url = safeUrl(f.url.value); if (url) m.url = url;
    return m;
  }
  function write(m) {
    var f = form.elements;
    f.title.value = (m.title || '').slice(0, 40); f.byline.value = (m.byline || '').slice(0, 40); f.url.value = safeUrl(m.url);
    RUBRIC.categories.forEach(function (c) {
      var u = (m.uses || []).filter(function (x) { return x.cat === c.id; })[0];
      var lv = u ? String(u.level) : '0', r = form.querySelector('input[name="lv-' + c.id + '"][value="' + lv + '"]');
      if (r) r.checked = true; f['tx-' + c.id].value = u ? u.text.slice(0, 52) : '';
    });
    f.human.value = (m.human || []).join(', ');
    rows();
  }
  function rows() {   // dim the categories that aren't used, so the used ones read as the log
    RUBRIC.categories.forEach(function (c) {
      var on = +(form.querySelector('input[name="lv-' + c.id + '"]:checked') || { value: 0 }).value > 0;
      form.querySelector('.g-row[data-cat="' + c.id + '"]').classList.toggle('used', on);
    });
  }

  // ---- the live card ----
  function rebuild(autoplay) {
    var m = read();
    if (player) player.pause();
    meter = SlopMeter.create(cv, m, RUBRIC);
    player = SlopMeter.player(meter, { sound: false });
    player.onTick(function (t, on) { scrub.value = Math.round(t / meter.DURATION * 1000); btn.textContent = on ? 'Pause' : (t >= meter.DURATION - 0.05 ? 'Replay' : 'Play'); });
    if (autoplay) player.play(); else player.seek(meter.DURATION);
    out.innerHTML = '<b>' + fmt(meter.SCORE) + '</b> / 100 &middot; ' + meter.VERDICT;
    try { localStorage.setItem(KEY, JSON.stringify(m)); } catch (e) { /* private window */ }
  }
  form.addEventListener('input', function () {
    // editing makes it yours: drop the shared link from the address bar so a reload keeps the edits, not the old link
    if (location.hash) { history.replaceState(null, '', location.pathname + location.search); shared.hidden = true; }
    rows(); clearTimeout(timer); timer = setTimeout(function () { rebuild(false); }, 180);
  });
  btn.addEventListener('click', function () { player.setSound(snd.checked); player.toggle(); });
  snd.addEventListener('change', function () { player.setSound(snd.checked); });
  scrub.addEventListener('input', function () { player.pause(); player.seek(scrub.value / 1000 * meter.DURATION); });
  cv.addEventListener('click', function () { btn.click(); });

  function load(url) {
    return fetch(url).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (m) { delete m.draft; write(m); rebuild(true); say('Loaded "' + m.title + '". Change anything; it\'s yours now.'); })
      .catch(function () { say('Couldn\'t load that one.'); });
  }

  // ---- the hand-offs ----
  function slug() { return (read().title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'slop') + '-slop-o-meter'; }
  function save(blob, name) { var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000); }
  function copy(text, what) { (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(function () { say(what + ' copied.'); }, function () { window.prompt('Copy this:', text); }); }
  function json(x) { return JSON.stringify(x).replace(/</g, '\\u003c'); }
  function link() { return location.origin + location.pathname + '#m=' + btoa(unescape(encodeURIComponent(JSON.stringify(read())))); }
  function blurb() { var m = read(), s = SlopMeter.score(m, RUBRIC); return m.title + ' scores ' + fmt(s.SCORE) + '/100 on the slop-o-meter (' + s.VERDICT.toLowerCase() + '). Here\'s where the AI went:'; }
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
    var m = read(), s = SlopMeter.score(m, RUBRIC), lines = ['Slop-o-meter: ' + fmt(s.SCORE) + '/100 (' + s.VERDICT.toLowerCase().replace(/\b\w/g, function (c) { return c.toUpperCase(); }) + '). Where the AI went:'];
    s.rows.forEach(function (r) { lines.push('- ' + r.text + ' (+' + fmt(r.pts) + ')'); });
    if (s.unused.length) lines.push('None: ' + s.unused.map(function (c) { return c.short; }).join(', ') + '.');
    if (m.human.length) lines.push('By hand: ' + m.human.join(', ') + '.');
    if (m.url) lines.push('See it: ' + m.url);
    lines.push('(Scored against the most AI it could have used: AI writing, direction, video and music weigh most, mastering least. Make your own at https://slopscore.org/slop-o-meter/)');
    return lines.join('\n');
  }
  var ACT = {
    html: function () {
      fetch(at(P.core || '../player/meter-core.js')).then(function (r) { return r.text(); }).then(function (core) {
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
          '<script>\n' + core + '\n</script>\n<script>\n(function(){var q=new URLSearchParams(location.search),RUBRIC=' + json(RUBRIC) + ',SLOP=' + json(m) + ';\n' +
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
      Promise.all([import(at(P.mp4 || './mp4-export.mjs')), off ? off.startRendering() : null]).then(function (r) {
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
  function showShared() {   // opened from somebody's link: say so, and offer the way on to their work
    var m = read(), s = SlopMeter.score(m, RUBRIC), go = shared.querySelector('.gen-shared-go'), sc = shared.querySelector('.gen-shared-score');
    shared.querySelector('h2').textContent = m.title + (m.byline ? ', ' + m.byline : '');
    sc.innerHTML = '<b>' + fmt(s.SCORE) + '</b> / 100 &middot; '; sc.appendChild(document.createTextNode(s.VERDICT));
    if (m.url) { go.href = m.url; go.textContent = 'Go to the work (' + new URL(m.url).hostname.replace(/^www\./, '') + ')'; go.hidden = false; }
    shared.hidden = false;
  }

  // ---- start: a shared link, ?from=, the last draft, or the defaults ----
  fetch(at(P.rubric || '../rubric.json')).then(function (r) { return r.json(); }).then(function (r) {
    RUBRIC = r;
    var h = location.hash.match(/^#m=(.+)$/), from = new URLSearchParams(location.search).get('from');
    if (h) { try { write(JSON.parse(decodeURIComponent(escape(atob(h[1]))))); showShared(); return rebuild(true); } catch (e) { say('That link didn\'t decode.'); } }
    if (from && P.slops && /^[a-z0-9-]+$/.test(from)) return load(at(P.slops + from + '.json'));
    var saved = null; try { saved = JSON.parse(localStorage.getItem(KEY)); } catch (e) { /* none */ }
    if (saved && saved.uses) write(saved);
    else write({ title: 'My Video', byline: 'a music video', uses: [{ cat: 'audio', level: 1, text: 'Song and vocals made with an AI music tool' }, { cat: 'writing', level: 0.5, text: 'Lyrics written with an AI from my draft' }], human: ['the idea', 'every note'] });
    rebuild(false);
  });
})();
