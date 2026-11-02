// MP4 export in the browser: step a deterministic renderAt(t) frame by frame, encode with WebCodecs (H.264 + AAC, or
// Opus where the browser has no AAC encoder) and mux with mp4-muxer. Nothing is uploaded; the file is built in memory.
// Shared by the slop-o-meter generator and the music-video maker. Every export ends on one slopscore.org credit frame.
//
//   import { canExport, exportMp4 } from './mp4-export.mjs';
//   const blob = await exportMp4({ canvas, width, height, fps, duration, renderFrame: async t => {...}, audio, onProgress, signal });
//
// renderFrame(t) must leave frame t drawn on `canvas`. audio is an AudioBuffer (or null for a silent video).
import { Muxer, ArrayBufferTarget } from './vendor/mp4-muxer.mjs';   // mp4-muxer 5.2.2, MIT (vendor/mp4-muxer.LICENSE)

// Waits that background tabs don't throttle. setTimeout drops to once a second (or a minute) in a hidden tab, and a
// timer-based wait on the encoder queue turned a three-minute export into hours. A MessageChannel round trip isn't
// throttled, and spinning on it lets the encoder's own tasks run until its queue drains.
// One channel for the life of the page: a channel made per wait can be garbage-collected before its message lands,
// and the wait then never ends (exports froze a few frames in).
const chan = new MessageChannel(), waiting = [];
chan.port1.onmessage = () => { const r = waiting.shift(); if (r) r(); };
const yieldNow = () => new Promise(r => { waiting.push(r); chan.port2.postMessage(0); });
async function drain(enc, max, stallMs, what) {
  const t = performance.now();
  while (enc.encodeQueueSize > max) {
    if (performance.now() - t > stallMs) throw new Error(`The ${what} encoder stopped responding. Try the 720p setting, or another browser.`);
    await yieldNow();
  }
}

export function canExport() {
  return typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined';
}

// High profile at the lowest level that fits, then Main and Baseline for encoders that refuse High.
function avcCodecs(width, height, fps) {
  const mbps = Math.ceil(width / 16) * Math.ceil(height / 16) * fps;
  const level = mbps <= 108000 ? '1f' : mbps <= 245760 ? '28' : mbps <= 522240 ? '2a' : '33';
  return ['avc1.6400' + level, 'avc1.4d00' + level, 'avc1.4200' + level];
}

// Some hardware H.264 encoders say yes to isConfigSupported and then never output a frame (an AMD card on Windows,
// 2026-10). So each candidate encodes two frames first, and only one that hands them back within 8 s is used.
// A stall is remembered in localStorage, so the next export goes straight to software.
async function encodes(cfg) {
  let out = 0, enc;
  try {
    enc = new VideoEncoder({ output: () => out++, error: () => {} });
    enc.configure(cfg);
    const c = new OffscreenCanvas(cfg.width, cfg.height); c.getContext('2d').fillRect(0, 0, cfg.width, cfg.height);
    for (let i = 0; i < 2; i++) { const f = new VideoFrame(c, { timestamp: i * 33333 }); enc.encode(f, { keyFrame: i === 0 }); f.close(); }
    const t = performance.now(); let done = false; enc.flush().then(() => { done = true; }, () => { done = true; });
    while (!done && performance.now() - t < 8000) await yieldNow();
  } catch (e) { /* not this one */ }
  try { enc && enc.state !== 'closed' && enc.close(); } catch (e) { /* closed */ }
  return out > 0;
}

async function pickVideo(width, height, fps, bitrate) {
  let hwStalls = false; try { hwStalls = localStorage.getItem('mp4-hw-stalls') === '1'; } catch (e) { /* private mode */ }
  for (const hardwareAcceleration of hwStalls ? ['prefer-software'] : ['prefer-hardware', 'prefer-software']) {
    for (const codec of avcCodecs(width, height, fps)) {
      const cfg = { codec, width, height, bitrate, framerate: fps, avc: { format: 'avc' }, hardwareAcceleration };
      try { if (!(await VideoEncoder.isConfigSupported(cfg)).supported) continue; } catch (e) { continue; }
      if (await encodes(cfg)) return cfg;
      if (hardwareAcceleration === 'prefer-hardware') {          // a hardware encoder that stalls stalls for every profile
        try { localStorage.setItem('mp4-hw-stalls', '1'); } catch (e) { /* private mode */ }
        break;
      }
    }
  }
  return null;
}

async function pickAudio(sampleRate, numberOfChannels) {
  if (typeof AudioEncoder === 'undefined') return null;
  for (const [codec, muxCodec] of [['mp4a.40.2', 'aac'], ['opus', 'opus']]) {
    const rate = codec === 'opus' ? 48000 : sampleRate;
    const cfg = { codec, sampleRate: rate, numberOfChannels, bitrate: 192000 };
    try { const s = await AudioEncoder.isConfigSupported(cfg); if (s.supported) return { cfg, muxCodec }; } catch (e) { /* next */ }
  }
  return null;
}

// Opus only takes 48 kHz: resample through an OfflineAudioContext when the song isn't.
async function resample(buf, rate) {
  if (buf.sampleRate === rate) return buf;
  const oc = new OfflineAudioContext(buf.numberOfChannels, Math.ceil(buf.duration * rate), rate);
  const s = oc.createBufferSource(); s.buffer = buf; s.connect(oc.destination); s.start();
  return oc.startRendering();
}

// The credit frame every export ends on: one frame after the video, so the picture people share (frame 0) stays theirs.
function creditCard(w, h) {
  const c = Object.assign(document.createElement('canvas'), { width: w, height: h }), g = c.getContext('2d'), u = h / 1080;
  g.fillStyle = '#1d120d'; g.fillRect(0, 0, w, h);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = '#c4ad94'; g.font = `600 ${Math.round(44 * u)}px Oswald, "Arial Narrow", sans-serif`; g.letterSpacing = `${Math.round(12 * u)}px`;
  g.fillText('MADE AT', w / 2, h * 0.36);
  g.fillStyle = '#e8669a'; g.font = `${Math.round(170 * u)}px Anton, Impact, sans-serif`; g.letterSpacing = `${Math.round(4 * u)}px`;
  g.fillText('SLOPSCORE.ORG', w / 2, h * 0.5);
  g.fillStyle = '#f6ead2'; g.font = `${Math.round(38 * u)}px Georgia, serif`; g.letterSpacing = '0px';
  g.fillText('Free music videos and slop-o-meters, made in your browser', w / 2, h * 0.64);
  return c;
}

export async function exportMp4({ canvas, width, height, fps = 30, duration, renderFrame, audio = null, bitrate, onProgress = () => {}, signal, credit = true }) {
  if (!canExport()) throw new Error('This browser can\'t encode video (no WebCodecs). Try a recent Chrome, Edge or Firefox.');
  width = width & ~1; height = height & ~1;
  bitrate = bitrate || Math.round(width * height * fps * 0.08);
  const vcfg = await pickVideo(width, height, fps, bitrate);
  if (!vcfg) throw new Error('This browser has no H.264 encoder for ' + width + 'x' + height + '.');
  let acfg = null;
  if (audio) {
    acfg = await pickAudio(audio.sampleRate, Math.min(2, audio.numberOfChannels));
    if (!acfg) throw new Error('This browser can\'t encode audio for an MP4. Try Chrome or Edge.');
    audio = await resample(audio, acfg.cfg.sampleRate);
  }

  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target, fastStart: 'in-memory', firstTimestampBehavior: 'offset',
    video: { codec: 'avc', width, height, frameRate: fps },
    ...(acfg ? { audio: { codec: acfg.muxCodec, numberOfChannels: acfg.cfg.numberOfChannels, sampleRate: acfg.cfg.sampleRate } } : {})
  });
  let failure = null;
  const venc = new VideoEncoder({ output: (c, m) => muxer.addVideoChunk(c, m), error: e => { failure = e; } });
  venc.configure(vcfg);

  // audio first: it's quick, and the muxer interleaves by timestamp
  if (acfg) {
    const aenc = new AudioEncoder({ output: (c, m) => muxer.addAudioChunk(c, m), error: e => { failure = e; } });
    aenc.configure(acfg.cfg);
    const ch = acfg.cfg.numberOfChannels, rate = audio.sampleRate, total = Math.min(audio.length, Math.ceil(duration * rate)), N = 4096;
    const src = Array.from({ length: ch }, (_, c) => audio.getChannelData(Math.min(c, audio.numberOfChannels - 1)));
    for (let i = 0; i < total; i += N) {
      const n = Math.min(N, total - i), data = new Float32Array(n * ch);
      for (let c = 0; c < ch; c++) data.set(src[c].subarray(i, i + n), c * n);
      const ad = new AudioData({ format: 'f32-planar', sampleRate: rate, numberOfFrames: n, numberOfChannels: ch, timestamp: Math.round(i / rate * 1e6), data });
      aenc.encode(ad); ad.close();
      await drain(aenc, 64, 15000, 'audio');
    }
    await aenc.flush(); aenc.close();
  }

  const frames = Math.max(1, Math.round(duration * fps)), key = fps * 2;
  const t0 = performance.now();
  for (let i = 0; i < frames; i++) {
    if (signal?.aborted) { venc.close(); throw new DOMException('Cancelled', 'AbortError'); }
    if (failure) throw failure;
    await renderFrame(i / fps);
    const vf = new VideoFrame(canvas, { timestamp: Math.round(i / fps * 1e6), duration: Math.round(1e6 / fps) });
    venc.encode(vf, { keyFrame: i % key === 0 }); vf.close();
    try { await drain(venc, 6, 15000, 'video'); } catch (e) { venc.close(); throw e; }
    if (i % 5 === 0 || i === frames - 1) {
      const done = (i + 1) / frames, el = (performance.now() - t0) / 1000;
      onProgress(done, el / done - el);
      await yieldNow();                                   // let the page update the progress text
    }
  }
  if (credit) {                                           // one last frame: the credit
    const vf = new VideoFrame(creditCard(width, height), { timestamp: Math.round(frames / fps * 1e6), duration: Math.round(1e6 / fps) });
    venc.encode(vf, { keyFrame: true }); vf.close();
  }
  await venc.flush(); venc.close();
  if (failure) throw failure;
  muxer.finalize();
  return new Blob([target.buffer], { type: 'video/mp4' });
}
