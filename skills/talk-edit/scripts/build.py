"""timeline.json -> edit.mp4: the cut picture and its sound.
Picture: every piece cut to whole frames from its take (with blur.json's boxes smeared out), cached per piece, then joined.
Sound: each piece read from its take X s past both ends and overlap-added with an equal-power crossfade centred on the join,
so cuts don't dip or click; a faint loop of the room's own quietest second runs underneath, so no join drops to digital
silence; then level_audio.py centres the voice and levels it to -14 LUFS.
blur.json (optional): [["c1", 12.0, 18.5, x, y, w, h], ...] in take seconds and 1920x1080 pixels (an email, an address bar,
a private link on screen). Check every screen recording for these before anyone else sees the cut.
usage: python build.py [project dir]   (needs cut.py first; ffmpeg on the PATH)"""
import hashlib, json, os, pathlib, subprocess, sys
import numpy as np

R = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else ".").resolve()
HERE = pathlib.Path(__file__).parent
tl = json.loads((R / "timeline.json").read_text(encoding="utf8")); segs, total, FPS = tl["segments"], tl["duration"], tl["fps"]
BLUR = json.loads((R / "blur.json").read_text(encoding="utf8")) if (R / "blur.json").exists() else []
SR, X = 48000, 0.04
(R / "pieces").mkdir(exist_ok=True)

# ---- picture ----
for s in segs:
    boxes = [b for b in BLUR if b[0] == s["take"] and b[2] > s["in"] and b[1] < s["out"]]
    vf = ",".join(f"delogo=x={max(1, b[3])}:y={max(1, b[4])}:w={b[5]}:h={b[6]}:enable='between(t,{b[1] - s['in']:.3f},{b[2] - s['in']:.3f})'" for b in boxes) or "null"
    key = hashlib.md5(json.dumps([s["src"], s["in"], s["out"], vf, FPS]).encode()).hexdigest()[:10]
    s["file"] = f"pieces/{s['i']:03d}_{key}.mkv"
    if (R / s["file"]).exists(): continue
    n = round(s["dur"] * FPS)
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-ss", f"{s['in']:.4f}", "-i", s["src"], "-frames:v", str(n), "-an",
                    "-vf", f"{vf},fps={FPS},format=yuv420p", "-c:v", "libx264", "-preset", "fast", "-crf", "16", str(R / s["file"])], check=True)
    print(f"piece {s['i'] + 1}/{len(segs)}", flush=True)
(R / "pieces" / "list.txt").write_text("".join(f"file '{pathlib.Path(s['file']).name}'\n" for s in segs), encoding="utf8")
subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", str(R / "pieces" / "list.txt"), "-c", "copy", str(R / "picture.mkv")], check=True)

# ---- sound ----
cache = {}
def take_audio(src):
    if src not in cache:
        raw = subprocess.run(["ffmpeg", "-v", "error", "-i", src, "-vn", "-ac", "2", "-ar", str(SR), "-f", "f32le", "-"], capture_output=True, check=True).stdout
        a = np.frombuffer(raw, np.float32).reshape(-1, 2)
        # one voice, centred: average the channels when they carry the same signal, else keep the louder one
        c = np.corrcoef(a[:, 0], a[:, 1])[0, 1] if a[:, 0].std() > 0 and a[:, 1].std() > 0 else 0
        m = a.mean(1) if c >= 0.5 else a[:, int(a[:, 1].std() > a[:, 0].std())]
        cache[src] = np.stack([m, m], 1)
    return cache[src]
n = int(round(total * SR)); out = np.zeros((n, 2), np.float32)
x = int(X * SR); ramp = np.sin(np.linspace(0, np.pi / 2, 2 * x, dtype=np.float32))[:, None]
for k, s in enumerate(segs):
    a = take_audio(s["src"]); o0 = int(round(s["start"] * SR)) - x; i0 = int(round(s["in"] * SR)) - x
    piece = a[max(0, i0):i0 + int(round(s["dur"] * SR)) + 2 * x].copy()
    if i0 < 0: piece = np.concatenate([np.zeros((-i0, 2), np.float32), piece])
    if k > 0: piece[:2 * x] *= ramp                                   # fade in across the join
    if k < len(segs) - 1: piece[-2 * x:] *= ramp[::-1]                  # fade out across the next
    p0, p1 = max(0, o0), min(n, o0 + len(piece)); out[p0:p1] += piece[p0 - o0:p1 - o0]
first = take_audio(segs[0]["src"]); hop = SR // 10
lv = np.sqrt((first[:len(first) // hop * hop].reshape(-1, hop, 2) ** 2).mean((1, 2))); win = np.convolve(lv, np.ones(10), "valid")
win[np.convolve(lv < 1e-5, np.ones(10), "valid") > 0] = np.inf   # never digital silence
k0 = int(np.argmin(win)); tone = first[k0 * hop:k0 * hop + SR].copy(); f = int(0.2 * SR); w = np.linspace(0, 1, f, dtype=np.float32)[:, None]
bed = np.zeros((0, 2), np.float32)
while len(bed) < n:
    t_ = tone.copy(); t_[:f] *= w; t_[-f:] *= w[::-1]
    if len(bed): bed[-f:] += t_[:f]; bed = np.concatenate([bed, t_[f:]])
    else: bed = t_
out += bed[:n] * 10 ** (-8 / 20)
raw = R / "sound_raw.wav"
pcm = (np.clip(out, -1, 1) * 32767).astype(np.int16)
import wave
with wave.open(str(raw), "wb") as wv: wv.setnchannels(2); wv.setsampwidth(2); wv.setframerate(SR); wv.writeframes(pcm.tobytes())
subprocess.run([sys.executable, str(HERE / "level_audio.py"), str(raw), str(R / "sound.wav")], check=True)
subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", str(R / "picture.mkv"), "-i", str(R / "sound.wav"), "-map", "0:v", "-map", "1:a",
                "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-shortest", str(R / "edit.mp4")], check=True)
print(f"edit.mp4: {int(total // 60)}:{total % 60:04.1f}, {len(segs)} pieces")
