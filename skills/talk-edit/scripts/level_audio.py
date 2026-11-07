"""Fold a talk's audio to centred mono and level it to -14 LUFS with one steady boost. loudnorm's linear=true silently falls back to riding the gain when the
input's true peak + the boost passes TP (one real talk: 0.35 dBTP + 5.1 dB, the gain swinging -0.9 to +8.9 dB), so: limit the
spikes first, by what the boost actually needs, then insist on linear and stop if not. No compressor: on that talk 2:1 and 3:1
both moved the gain more than the fallback did; a limiter alone barely moves it.
usage: python level_audio.py <input with audio> <out.wav>"""
import json, re, subprocess, sys
import numpy as np
INP, OUT = sys.argv[1], sys.argv[2]
I, TP, LRA = -14.0, -1.5, 11
MAX_CUT = 10.0                     # stop if the limiter would have to take more than this off the peaks: the takes are too spiky
NORM = f"loudnorm=I={I}:TP={TP}:LRA={LRA}"

def measure(af):
    err = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", INP, "-vn", "-af", af + ":print_format=json", "-f", "null", "-"],
                         capture_output=True, text=True, encoding="utf8", errors="replace").stderr
    return json.loads(err[err.rindex("{"):err.rindex("}") + 1])

def fold():
    # A talk is one voice, so it goes out as centred mono (some mics record one channel 6 dB hotter, and the voice then sounds
    # like it comes from one speaker). Same signal on both channels: average them. Different signals: averaging
    # could cancel, so take the louder one and say so.
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", INP, "-vn", "-ac", "2", "-ar", "16000", "-f", "f32le", "-"], capture_output=True).stdout
    a = np.frombuffer(raw, np.float32).reshape(-1, 2); sl, sr = a[:, 0].std(), a[:, 1].std()
    corr = float(np.corrcoef(a[:, 0], a[:, 1])[0, 1]) if sl > 0 and sr > 0 else 0.0
    print(f"channels: L-R {20 * np.log10((sl + 1e-9) / (sr + 1e-9)):+.1f} dB, correlation {corr:.3f}", flush=True)
    if corr >= 0.5: return "pan=stereo|c0=0.5*c0+0.5*c1|c1=0.5*c0+0.5*c1"
    print("channels differ: using the louder one, check by ear", flush=True)
    return "pan=stereo|c0=c0|c1=c0" if sl >= sr else "pan=stereo|c0=c1|c1=c1"

pre = fold() + ",highpass=f=80"
ceil = 0.0                         # the limiter's ceiling in dB; each round re-measures, since limiting lowers the loudness a little
for _ in range(5):
    chain = pre + f",alimiter=limit={10 ** (ceil / 20):.4f}:attack=5:release=60:level=disabled:latency=1"
    m = measure(f"{chain},{NORM}"); boost = I - float(m["input_i"]); tp = float(m["input_tp"])
    print(f"ceiling {ceil:.1f} dB: {m['input_i']} LUFS, {tp} dBTP, boost {boost:+.1f} dB", flush=True)
    if tp + boost <= TP - 0.1: break
    if not ceil: top = tp                                      # the peaks with no limiting, for MAX_CUT
    ceil = min(ceil, TP - 0.4 - boost) - (0.3 if ceil else 0)
    if top - ceil > MAX_CUT: sys.exit(f"level_audio: the limiter would take {top - ceil:.1f} dB off the peaks (limit {MAX_CUT}); check the takes")
else:
    sys.exit("level_audio: peaks never settled under the true-peak limit")
second = (f"{NORM}:measured_I={m['input_i']}:measured_TP={m['input_tp']}:measured_LRA={m['input_lra']}:measured_thresh={m['input_thresh']}"
          f":offset={m['target_offset']}:linear=true")
t = measure(f"{chain},{second}")
print(f"levelled: {t['output_i']} LUFS, {t['output_tp']} dBTP, {t['normalization_type']}", flush=True)
if t["normalization_type"].lower() != "linear": sys.exit("level_audio: loudnorm fell back to riding the gain")
subprocess.run(["ffmpeg", "-y", "-v", "error", "-stats", "-i", INP, "-vn", "-af", f"{chain},{second},aresample=48000", "-c:a", "pcm_s24le", OUT], check=True)
