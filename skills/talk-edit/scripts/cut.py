"""plan.json -> timeline.json: the cut. Each planned piece of a take is trimmed to real silence at both ends, its long pauses
are tightened, mic dropouts (digital silence) are cut out, and every piece is rounded to whole frames.

The rules (each one fixed a real complaint about AI-cut talks):
- An edge only ever sits in real silence, measured on the take's own loudness (5 ms steps), never on whisper's word times,
  which run 0.1-0.2 s off: a cut placed from them clips the ends of words.
- An out edge keeps AIR_OUT s of quiet after the last word, an in edge AIR_IN s before the first, so cuts don't feel abrupt.
- A pause of MIN_PAUSE s or more is tightened: KEEP_AFTER s stays after the speech, KEEP_BEFORE s before the next, the middle
  goes. A cut that would save under 0.6 s isn't worth the jump. Cutting too close and too often was the commonest note.
- Pieces are rounded to whole frames here, because the picture is cut to whole frames: with ~75 cuts, unrounded times drifted
  the overlays 0.2 s off the picture by the end.

plan.json:
{ "fps": 30, "min_pause": 1.3,
  "pieces": [ {"take": "c1", "in": 0.5, "out": 94.8, "note": "the intro"},
              {"take": "c1", "in": 103.8, "out": 573.6, "exact_out": true, "note": "keeps the waving after the last word"} ] }
  "exact_in"/"exact_out": use the time as given (a gesture or a beat after the last word); "tighten": false keeps a piece's pauses.
usage: python cut.py [project dir]   (needs transcribe.py first)"""
import json, pathlib, subprocess, sys
import numpy as np

R = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else ".")
plan = json.loads((R / "plan.json").read_text(encoding="utf8"))
FPS = plan.get("fps", 30)
MIN_PAUSE = plan.get("min_pause", 1.3)
KEEP_AFTER, KEEP_BEFORE = plan.get("keep_after", 0.45), plan.get("keep_before", 0.40)
AIR_OUT, AIR_IN, REACH, RUN = 0.24, 0.16, 0.30, 20     # RUN: 100 ms of quiet, so a stop inside a word never passes for a pause
TAKES = dict(l.split(" ", 1) for l in (R / "takes.txt").read_text(encoding="utf8").splitlines() if l.strip() and not l.startswith("#"))

ENV = {}
def env(take):
    """loudness in 5 ms steps, and the floor under which it counts as quiet"""
    if take not in ENV:
        # the original recording as float, not the 16-bit analysis copy: there quiet room tone rounds to exact zero and passes for a dropout
        raw = subprocess.run(["ffmpeg", "-v", "error", "-i", TAKES[take].strip(), "-vn", "-ac", "1", "-ar", "16000", "-f", "f32le", "-"], capture_output=True, check=True).stdout
        x = np.frombuffer(raw, np.float32); hop = 80; n = len(x) // hop
        db = 20 * np.log10(np.sqrt((x[:n * hop].reshape(n, hop) ** 2).mean(1)) + 1e-6)
        zero = np.abs(x[:n * hop].reshape(n, hop)).max(1) == 0                   # digital silence: a mic dropout
        ENV[take] = (db, max(np.percentile(db, 95) - 30, np.percentile(db, 10) + 8), zero)
    return ENV[take]

def quiet_from(db, fl, k): return k + RUN <= len(db) and (db[k:k + RUN] < fl).all()       # RUN blocks of quiet start at k
def quiet_to(db, fl, k): return k - RUN + 1 >= 0 and (db[k - RUN + 1:k + 1] < fl).all()   # ... end at k

def clean_out(take, t):
    db, fl, _ = env(take); n = len(db); i = min(n - 1, int(round(t * 200)))
    j = i
    while j > 0 and db[j] < fl and i - j < 200: j -= 1        # back to the last sound before t, if t is in quiet
    if db[j] < fl: return t
    k = j
    while k < n - 1 and not quiet_from(db, fl, k) and k - j < REACH * 200: k += 1
    if not quiet_from(db, fl, k):                                           # no quiet in reach: the next word touches this one; take the deepest dip
        i0, i1 = max(0, i - 6), min(n, i + int(REACH * 200)); return (i0 + int(np.argmin(db[i0:i1]))) / 200
    q = k
    while q < n - 1 and db[q] < fl and q - k < AIR_OUT * 200: q += 1
    if q < n - 1 and db[q] >= fl: q = max(k, q - 2)          # stop short of the next sound
    return q / 200

def clean_in(take, t):
    db, fl, _ = env(take); n = len(db); i = min(n - 1, int(round(t * 200)))
    j = i
    while j < n - 1 and db[j] < fl and j - i < 200: j += 1    # forward to the first sound after t, if t is in quiet
    if db[j] < fl: return t
    k = j
    while k > 0 and not quiet_to(db, fl, k) and j - k < REACH * 200: k -= 1
    if not quiet_to(db, fl, k):
        i0, i1 = max(0, i - int(REACH * 200)), min(n, i + 6); return (i0 + int(np.argmin(db[i0:i1]))) / 200
    q = k
    while q > 0 and db[q] < fl and k - q < AIR_IN * 200: q -= 1
    if q > 0 and db[q] >= fl: q = min(k, q + 2)
    return q / 200

def quiet_runs(take, a, b, min_len):
    db, fl, _ = env(take); i, i1, out = int(a * 200) + 1, min(len(db), int(b * 200)) - 1, []
    while i < i1:
        if db[i] >= fl: i += 1; continue
        j = i
        while j < i1 and db[j] < fl: j += 1
        if (j - i) / 200 >= min_len: out.append((i / 200, j / 200))
        i = j + 1
    return out

segs, t = [], 0.0
for p in plan["pieces"]:
    take = p["take"]
    a = p["in"] if p.get("exact_in") else clean_in(take, p["in"])
    b = p["out"] if p.get("exact_out") else clean_out(take, p["out"])
    b = min(b, len(env(take)[0]) / 200 - 0.05)              # never past the end of the recording (an exact_out can ask for it)
    pieces, x = [], a
    if p.get("tighten", True):
        for q0, q1 in quiet_runs(take, a, b, MIN_PAUSE):
            c0, c1 = q0 + KEEP_AFTER, q1 - KEEP_BEFORE
            if c1 - c0 < 0.6: continue
            pieces.append((x, c0)); x = c1
    pieces.append((x, b))
    # mic dropouts: a run of digital silence over 0.15 s is cut out (inside speech the cut widens to the quiet around it)
    _, _, zero = env(take); d = np.diff(np.concatenate([[0], zero.astype(np.int8), [0]]))
    for z0, z1 in zip(np.where(d == 1)[0] / 200, np.where(d == -1)[0] / 200):
        if z1 - z0 < 0.15: continue
        cut0, cut1 = clean_out(take, z0 - 0.02), clean_in(take, z1 + 0.02)
        nxt = []
        for x0, x1 in pieces:
            if cut1 <= x0 or cut0 >= x1: nxt.append((x0, x1)); continue
            if cut0 > x0: nxt.append((x0, cut0))
            if cut1 < x1: nxt.append((cut1, x1))
        pieces = nxt
    for x0, x1 in pieces:
        if x1 - x0 < 0.2: continue
        d_ = round((x1 - x0) * FPS) / FPS                    # whole frames
        segs.append({"i": len(segs), "take": take, "src": TAKES[take].strip(), "in": round(x0, 4), "out": round(x0 + d_, 4),
                     "start": round(t, 4), "dur": d_})
        t += d_
(R / "timeline.json").write_text(json.dumps({"fps": FPS, "duration": round(t, 4), "segments": segs}, indent=1), encoding="utf8")
print(f"{len(segs)} pieces, {int(t // 60)}:{t % 60:04.1f}")
