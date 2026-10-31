"""Put a rendered video on the review page as the next draft: out/<name>.mp4, a seek-friendly review copy, and the diff
from the previous draft (the cyan strip and the heatmap). Works for any pipeline (Three.js, Blender, Godot, Remotion,
an OBS edit): whatever made the video, hand it here when it's done.
usage: python add_draft.py <project dir> <video.mp4> [name]        name: draft7, ps-draft2 ... (default: the next draftN)
       python add_draft.py <project dir> --shots shots.json <name>  attach a shot list [{name, t0, t1}] to an existing draft
A video already at out/<name>.mp4 is used in place (no copy)."""
import os, sys, re, shutil, subprocess, pathlib

HERE = pathlib.Path(__file__).resolve().parent
DRE = re.compile(r'^(?:([a-z][a-z0-9]*)-)?draft(\d+)([a-z]?)$')

def next_name(out, piece=''):
    nums = [int(m.group(2)) for p in out.glob('*.mp4') if (m := DRE.match(p.stem)) and (m.group(1) or '') == piece]
    return f"{piece + '-' if piece else ''}draft{max(nums, default=0) + 1}"

def main(a):
    root = pathlib.Path(a[0]).resolve(); out = root / 'out'; out.mkdir(parents=True, exist_ok=True); (root / 'review').mkdir(exist_ok=True)
    if a[1] == '--shots':
        shutil.copy2(a[2], out / f'{a[3]}_shots.json'); print('shots ->', out / f'{a[3]}_shots.json'); return
    src = pathlib.Path(a[1]).resolve(); name = a[2] if len(a) > 2 else next_name(out)
    if not DRE.match(name): sys.exit(f'{name}: drafts are named draftN or <piece>-draftN (lowercase piece)')
    master = out / f'{name}.mp4'
    if src != master: shutil.copy2(src, master); print('master ->', master)
    # the review copy: a keyframe every second so seeking and frame-stepping never stall the browser
    rev = out / f'{name}_review.mp4'
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(master), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-g', '30', '-keyint_min', '30',
                    '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', str(rev)], check=True)
    print('review copy ->', rev)
    (out / f'{name}.rendering.json').unlink(missing_ok=True)
    # the diff from the previous draft; the review server would make it anyway, this has it ready before the page opens
    subprocess.run([sys.executable, str(HERE / 'changes.py'), name], cwd=root, env={**os.environ, 'REVIEW_ROOT': str(root)}, check=False)

if __name__ == '__main__':
    if len(sys.argv) < 3: sys.exit(__doc__)
    main(sys.argv[1:])
