"""What changed between two drafts, found by watching them: out/<draft>_changes.json for the review harness.
Both drafts are decoded small (160x90 grey, 6 fps) and compared at the same SONG time (partial drafts are placed by
their out/<draft>_span.json). The player is deterministic (grain and halftone are seeded by frame), so an unchanged
frame matches almost exactly; a sample counts as changed when enough of the frame moved. Changed samples are merged
into regions and labelled with the shot names they cover. A manual list (review/changes_<draft>.manual.json, same
format) is merged in for edits the eye can't see in a thumbnail.
Drafts may carry a piece prefix (ps-draft2, short1-draft3); each piece is compared only with its own earlier drafts.
usage: python changes.py <draft> [previous_draft]     (default previous: the draft before it in number order)
       python changes.py --all                         (every draft against the one before it)
The project is REVIEW_ROOT, else the folder above this script (a project's own tools/ copy); the review server sets it."""
import sys, json, os, pathlib, subprocess, re
import numpy as np

ROOT = pathlib.Path(os.environ.get('REVIEW_ROOT') or pathlib.Path(__file__).resolve().parent.parent).resolve()
OUT, CACHE = ROOT / 'out', ROOT / 'review' / 'changes_cache'
FPS, W, H = 6, 160, 90
PIX, FRAC, GAP, MINLEN = 22, .035, 1.2, .5   # a pixel moved > PIX/255; a sample changed if > FRAC of the frame did; merge gaps < GAP s; drop runs < MINLEN s

DRE = re.compile(r'^(?:([a-z][a-z0-9]*)-)?draft(\d+)([a-z]?)$')
def piece(d): m = DRE.match(d); return (m.group(1) or '') if m else ''
def num(d): m = DRE.match(d); return (int(m.group(2)), m.group(3)) if m else (0, '')
def drafts(pc=None): return sorted([p.stem for p in OUT.glob('*.mp4') if DRE.match(p.stem) and (pc is None or piece(p.stem) == pc)], key=num)
def span(d):
    f = OUT / f'{d}_span.json'
    return json.loads(f.read_text())['t0'] if f.exists() else 0.0

def frames(d):   # (t0, array[n, H, W]) in song time, cached
    CACHE.mkdir(parents=True, exist_ok=True); src = OUT / f'{d}.mp4'; c = CACHE / f'{d}.npy'
    if c.exists() and c.stat().st_mtime > src.stat().st_mtime: return span(d), np.load(c)
    raw = subprocess.run(['ffmpeg', '-loglevel', 'error', '-i', str(src), '-vf', f'fps={FPS},scale={W}:{H},format=gray', '-f', 'rawvideo', '-'], capture_output=True, check=True).stdout
    a = np.frombuffer(raw, np.uint8).reshape(-1, H, W); np.save(c, a); return span(d), a

def prev_of(d):
    """the earlier drafts, newest first, back to and including the last FULL one (partials only cover their span)"""
    ds = drafts(piece(d)); i = ds.index(d); out = []
    for p in reversed(ds[:i]):
        out.append(p)
        if not (OUT / f'{p}_span.json').exists(): break
    return out or None

def shots_for(d):
    f = OUT / f'{d}_shots.json'
    return json.loads(f.read_text()) if f.exists() else []

def compare(d, p):
    """d against p, or against a list of earlier drafts newest first: each sample is compared with the NEWEST earlier draft
    that covers its song time (a partial draft 4c covers 0-56 s, the last full draft the rest), so a partial round shows
    only its own changes instead of everything since the last full render"""
    ps = p if isinstance(p, list) else [p]
    t0a, a = frames(d); frac = np.zeros(len(a)); has = np.zeros(len(a), bool)
    for q in ps:
        t0b, b = frames(q)
        for i in range(len(a)):
            if has[i]: continue
            j = int(round((t0a + i / FPS - t0b) * FPS))
            if 0 <= j < len(b):
                frac[i] = (np.abs(a[i].astype(np.int16) - b[j].astype(np.int16)) > PIX).mean(); has[i] = True
    frac[~has] = 1.0   # picture no earlier draft had
    n = len(a); ch = frac > FRAC
    regions, i = [], 0
    while i < n:
        if not ch[i]: i += 1; continue
        j = i
        while j < n and (ch[j] or ch[j:j + int(GAP * FPS)].any()): j += 1
        r0, r1 = t0a + i / FPS, t0a + j / FPS
        if r1 - r0 >= MINLEN: regions.append([r0, r1, float(frac[i:j].mean())])
        i = j
    return regions, frac

def label(regions, d):
    sh = shots_for(d); out = []
    for r0, r1, amt in regions:
        names = []
        for s in sh:
            if s['t0'] < r1 and s.get('t1', 1e9) > r0 and s['name'] not in names: names.append(s['name'])
        lab = ('changed: ' + ', '.join(names[:4]) + (' ...' if len(names) > 4 else '')) if names else 'changed'
        out.append({'t0': round(r0, 2), 't1': round(r1, 2), 'label': lab, 'amount': round(amt, 3)})
    return out

def run(d, p=None):
    p = p or prev_of(d)
    if not p: print(f'{d}: no earlier full draft to compare'); return
    regions, _ = compare(d, p); regs = label(regions, d)
    man = ROOT / 'review' / f'changes_{d}.manual.json'
    if man.exists(): regs += json.loads(man.read_text()).get('regions', [])
    regs.sort(key=lambda r: r['t0'])
    vs = ', '.join(p) if isinstance(p, list) else p
    (OUT / f'{d}_changes.json').write_text(json.dumps({'draft': d, 'vs': vs, 'regions': regs}, indent=1))
    tot = sum(r['t1'] - r['t0'] for r in regs)
    print(f'{d} vs {vs}: {len(regs)} changed regions, {tot:.1f} s changed')

if __name__ == '__main__':
    if sys.argv[1:] == ['--all']:
        for pc in sorted({piece(x) for x in drafts()}):
            for d in drafts(pc)[1:]: run(d)
    else: run(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else None)
