"""Synthesise the slop-o-meter's sound from the page's event list (no samples, no downloads).

    python scripts/sfx.py <events.json> <out.wav>

intro: a brass clunk and the cabin's creak.  row: a typewriter clack as the line is typed, then a ratchet that clicks
once per point as the needle kicks.  foot: a pen scratch.  stamp: a rubber-stamp thump and the ship's bell.
Under it all: low brown-noise hull rumble and slop bubbling, so the card is never dead silent.
"""
import json
import sys
import wave

import numpy as np

SR = 48000
rng = np.random.default_rng(42)


def env(n, attack, decay):
    t = np.arange(n) / SR
    return np.minimum(1, t / max(attack, 1e-4)) * np.exp(-t / decay)


def lowpass(x, k):
    return np.convolve(x, np.ones(k) / k, mode="same")


def add(buf, t, sig, gain=1.0):
    i = int(t * SR)
    if i >= len(buf):
        return
    j = min(len(buf), i + len(sig))
    buf[i:j] += sig[: j - i] * gain


def clack():
    n = int(0.05 * SR)
    hit = rng.standard_normal(n) * env(n, 0.0005, 0.008)
    body = np.sin(2 * np.pi * 1800 * np.arange(n) / SR) * env(n, 0.0003, 0.012)
    return np.diff(hit, prepend=0) * 0.7 + body * 0.25


def click(pitch=1.0):
    n = int(0.012 * SR)
    return np.diff(rng.standard_normal(n), prepend=0) * env(n, 0.0002, 0.0018) * 0.5 + \
        np.sin(2 * np.pi * 3200 * pitch * np.arange(n) / SR) * env(n, 0.0002, 0.003) * 0.3


def thump():
    n = int(0.6 * SR)
    t = np.arange(n) / SR
    low = np.sin(2 * np.pi * (60 + 40 * np.exp(-t / 0.03)) * t) * env(n, 0.001, 0.16)
    knock = lowpass(rng.standard_normal(n), 12) * env(n, 0.0005, 0.03)
    return low * 0.9 + knock * 1.4


def bell(f=740):
    n = int(3.2 * SR)
    t = np.arange(n) / SR
    out = np.zeros(n)
    for ratio, amp, dec in [(0.5, 0.5, 2.6), (1.0, 1.0, 2.2), (1.19, 0.5, 1.4), (1.56, 0.35, 1.1), (2.0, 0.4, 0.9), (2.74, 0.25, 0.6), (3.76, 0.12, 0.4)]:
        out += amp * np.sin(2 * np.pi * f * ratio * t + ratio) * env(n, 0.002, dec)
    return out * 0.32


def clunk():
    n = int(0.4 * SR)
    t = np.arange(n) / SR
    ring = sum(np.sin(2 * np.pi * f * t) * a for f, a in [(210, 1), (377, 0.6), (612, 0.35)]) * env(n, 0.001, 0.09)
    return ring * 0.5 + lowpass(rng.standard_normal(n), 6) * env(n, 0.0005, 0.02) * 0.8


def scratch(dur=0.5):
    n = int(dur * SR)
    t = np.arange(n) / SR
    grain = np.diff(rng.standard_normal(n), prepend=0) * (0.5 + 0.5 * np.abs(np.sin(2 * np.pi * 9 * t)))
    return grain * np.minimum(1, t / 0.05) * np.minimum(1, (dur - t) / 0.1) * 0.12


def bed(dur):
    n = int(dur * SR)
    brown = np.cumsum(rng.standard_normal(n))
    brown -= lowpass(brown, 4801)          # keep the rumble, drop the drift
    brown /= np.max(np.abs(brown)) + 1e-9
    out = brown * 0.06
    for _ in range(int(dur * 3)):          # slop bubbles: little pitched blips that rise
        m = int(0.07 * SR)
        tt = np.arange(m) / SR
        f0 = rng.uniform(250, 600)
        blip = np.sin(2 * np.pi * (f0 + 2500 * tt) * tt) * env(m, 0.004, 0.02) * rng.uniform(0.03, 0.08)
        add(out, rng.uniform(0, dur), blip)
    return out


def main(events_path, out_path):
    spec = json.load(open(events_path))
    dur = spec["duration"] + 0.2
    buf = bed(dur)
    for e in spec["events"]:
        t = e["t"]
        if e["type"] == "intro":
            add(buf, t, clunk(), 0.9)
        elif e["type"] == "row":
            for k in range(9):              # typing the line
                add(buf, t + 0.02 + k * 0.042 + rng.uniform(-0.006, 0.006), clack(), 0.55)
            clicks = max(1, int(round(e["pts"])))
            span = min(0.42, 0.028 * clicks)
            for k in range(clicks):         # the needle's ratchet, one click a point
                add(buf, e["kick"] + k * span / clicks, click(1 + k * 0.02), 0.7)
        elif e["type"] == "foot":
            add(buf, t, scratch(0.45), 1.0)
        elif e["type"] == "stamp":
            add(buf, t, thump(), 1.0)
            add(buf, t + 0.18, bell(), 1.0)
    fade = int(0.25 * SR)
    buf[-fade:] *= np.linspace(1, 0, fade)
    buf /= np.max(np.abs(buf)) + 1e-9
    buf = np.tanh(buf * 1.8) / np.tanh(1.8)      # soft-clip the clicks so the whole card sits near -16 LUFS
    buf *= 0.89                                  # -1 dBFS peak
    pcm = (np.clip(buf, -1, 1) * 32767).astype(np.int16)
    with wave.open(out_path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    print("wrote", out_path, f"{dur:.2f} s")


if __name__ == "__main__":
    main(*sys.argv[1:3])
