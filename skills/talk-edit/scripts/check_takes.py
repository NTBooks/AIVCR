"""Scan fresh takes right after recording, while a line can still be redone (a wireless mic that drops out only shows up
in the edit otherwise). Per take: mic dropouts (exact digital silence), clicks, full-scale samples, level,
left/right balance, and (on Windows with OBS) the mic resets OBS logged during the take. Exit 1 if any take has a dropout: read the REDO list, say those lines again.
usage: python check_takes.py <take.mp4 ...>     or   --takes takes.txt     or   --latest 5 (newest .mp4 in ~/Videos)"""
import argparse, datetime as dt, glob, os, re, subprocess, sys, numpy as np
SR = 48000
ap = argparse.ArgumentParser(); ap.add_argument("takes", nargs="*"); ap.add_argument("--takes", "--clips", dest="clips"); ap.add_argument("--latest", type=int)
args = ap.parse_args()
takes = list(args.takes)
if args.clips:
    takes += [l.split(" ", 1)[1].strip() for l in open(args.clips, encoding="utf8") if " " in l.strip() and not l.lstrip().startswith("#")]
if args.latest:
    takes += sorted(glob.glob(os.path.expanduser("~/Videos/*.mp4")), key=os.path.getmtime)[-args.latest:]
if not takes: ap.error("no takes")

def obs_resets():
    # the wall-clock time of every mic reset in every OBS log; log lines carry only the time, the file name the start date
    out = []
    for f in glob.glob(os.path.expandvars("%APPDATA%/obs-studio/logs/*.txt")):
        m = re.match(r"(\d{4}-\d\d-\d\d) (\d\d)-(\d\d)-(\d\d)", os.path.basename(f))
        if not m: continue
        day = dt.datetime.strptime(m[1], "%Y-%m-%d"); prev = int(m[2])
        for l in open(f, encoding="utf8", errors="replace"):
            h = re.match(r"(\d\d):(\d\d):(\d\d)\.\d+: Device '.*' invalidated", l)
            if h:
                if int(h[1]) < prev: day += dt.timedelta(days=1)
                prev = int(h[1]); out.append(day.replace(hour=int(h[1]), minute=int(h[2]), second=int(h[3])))
    return out

def clicks(m, thr=30):
    # one sample jump far above everything else in its 5 ms (sibilants and voiced speech are not this peaky)
    d = np.abs(np.diff(m, 2)); B = 240; n = len(d) // B; b = d[:n * B].reshape(-1, B); mx = b.max(1); md = np.median(b, 1) + 1e-6
    return np.where((mx / md > thr) & (mx > 0.02))[0] * B / SR

def fmt(t): return f"{int(t // 60)}:{t % 60:04.1f}"

resets = obs_resets(); redo = []
print(f"{'take':34s} {'min':>5s} {'drops':>5s} {'lost s':>6s} {'resets':>6s} {'clicks':>6s} {'hot':>6s} {'peak dB':>7s} {'speech dB':>9s} {'L-R dB':>6s}")
for p in takes:
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", p, "-vn", "-ac", "2", "-ar", str(SR), "-f", "f32le", "-"], capture_output=True).stdout
    a = np.frombuffer(raw, np.float32).reshape(-1, 2)
    if not len(a):
        print(f"{os.path.basename(p):34s} no audio"); redo.append((p, ["no audio track"])); continue
    # dropouts: exact zeros on both channels for 100 ms or more, runs under 1.5 s apart counted as one
    z = (np.abs(a).max(1) == 0).astype(np.int8); e = np.diff(np.concatenate([[0], z, [0]])); s0, s1 = np.where(e == 1)[0], np.where(e == -1)[0]
    runs = []
    for x, y in zip(s0 / SR, s1 / SR):
        if y - x < 0.1: continue
        if runs and x - runs[-1][1] < 1.5: runs[-1][1] = y
        else: runs.append([x, y])
    m = a.mean(1); c = clicks(m); dur = len(a) / SR
    mt = re.match(r"(\d{4}-\d\d-\d\d) (\d\d)-(\d\d)-(\d\d)", os.path.basename(p)); n_res = 0
    if mt:
        t0 = dt.datetime.strptime(f"{mt[1]} {mt[2]}:{mt[3]}:{mt[4]}", "%Y-%m-%d %H:%M:%S")
        n_res = sum(t0 <= r <= t0 + dt.timedelta(seconds=dur) for r in resets)
    hop = 4800; n = len(m) // hop; lv = 20 * np.log10(np.sqrt((m[:n * hop].reshape(-1, hop) ** 2).mean(1)) + 1e-7)
    speech = np.median(lv[lv > -45]) if (lv > -45).any() else -99.0
    hot = int((np.abs(a) >= 0.98).any(1).sum()); peak = 20 * np.log10(np.abs(a).max() + 1e-7)
    # channel balance: some mics record one channel hotter (or a -6 dB safety copy on the other), so a voice left as stereo sounds like it comes from one speaker
    bal = 20 * np.log10((a[:, 0].std() + 1e-9) / (a[:, 1].std() + 1e-9)); corr = np.corrcoef(a[:, 0], a[:, 1])[0, 1] if a[:, 0].std() > 0 and a[:, 1].std() > 0 else 0.0
    print(f"{os.path.basename(p):34s} {dur / 60:5.1f} {len(runs):5d} {sum(y - x for x, y in runs):6.1f} {n_res:6d} {len(c):6d} {hot:6d} {peak:7.1f} {speech:9.1f} {bal:6.1f}")
    if runs: redo.append((p, [f"dropout {fmt(x)}-{fmt(y)}" for x, y in runs]))
    if hot: print(f"   hot: {hot} samples at full scale, turn the gain down")
    if abs(bal) > 1.5: print(f"   lopsided: {'left' if bal > 0 else 'right'} channel {abs(bal):.1f} dB hotter (correlation {corr:.3f}); level_audio.py folds it to centred mono, no redo needed")
    if corr < 0.5: print(f"   channels differ (correlation {corr:.3f}): not one mic on two channels; level_audio.py uses the louder one, check by ear")
    if len(c): print("   listen for a click at " + ", ".join(fmt(t) for t in c[:12]))
if redo:
    print("\nREDO")
    for p, notes in redo: print(f"  {os.path.basename(p)}: " + "; ".join(notes))
    sys.exit(1)
print("\nno dropouts")
