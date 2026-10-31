---
name: review-harness
description: A local review page for video drafts - the user watches a draft that knows its frame, shot and sung line, pauses, drags boxes over what they mean (right-click a box to remove it), types notes that land in review/notes_<draft>.json with a marked-up JPEG of the frame, marks earlier notes fixed or still broken, and sees what changed since the previous draft as a cyan strip over a heatmap of how often each moment has been reworked. Use it whenever a video has a draft for the user to review, the user says "review page", "harness", "let me leave notes", "notes are in", "heatmap", "what changed", or a new video project starts (set it up before the first draft) - for any pipeline (Three.js, Blender, Godot, Remotion, ffmpeg edits, talking-head cuts).
---

# Review harness

A small Node server and one HTML page. The user reviews drafts in their browser; Claude reads the notes as JSON.
Nothing leaves the machine: the server listens on 127.0.0.1 only.

```
node ~/.claude/skills/review-harness/scripts/review_server.mjs 5190 <project dir>   ->  http://127.0.0.1:5190/
```

Needs Node 18+, Python 3 with numpy, and ffmpeg on the PATH.

## Project layout

The server works on any folder. It creates what is missing.

```
<project>/out/draft1.mp4            the drafts: draftN.mp4, or <piece>-draftN.mp4 for several videos in one project
<project>/out/draft1_review.mp4     seek-friendly copy (keyframe every second); the page plays it when it exists
<project>/out/draft1_shots.json     optional shot list [{name, t0, t1}] shown in the HUD and on change labels
<project>/out/draft1_changes.json   what changed since the previous draft (made automatically, see below)
<project>/out/pieces.json           optional tab labels {"": "Main video", "ps": "P.S."}
<project>/player/lines.json         optional lyric/subtitle lines [{t0, t1, text}] (also read: audio/lyrics.json)
<project>/review/notes_draft1.json  the user's notes             review/notes_draft1/<id>.jpg  their marked-up frames
<project>/review/verdicts_draft2.json   fixed / still broken on earlier notes, judged while watching draft2
<project>/review/notes_draft1.done  written when the user presses "Done: send to Claude"
```

## Every new draft

```
python ~/.claude/skills/review-harness/scripts/add_draft.py <project dir> <rendered.mp4>        # becomes the next draftN
python ~/.claude/skills/review-harness/scripts/add_draft.py <project dir> <rendered.mp4> ps-draft2
```

add_draft copies the video to out/, makes the review copy, and runs changes.py against the previous draft. If a
pipeline writes out/draftN.mp4 itself, pass that path; it is used in place.

**The diff and the heatmap are always there.** The server runs changes.py itself, at startup and whenever the page
opens a draft, for every draft whose change list is missing or older than its video, earlier drafts first. Nothing
in the render pipeline has to remember it. While it works the Changes tab says "finding..." and the page fills in
when it's done. If the strip is still missing, read the server's console: it prints why changes.py failed.

How the diff works: both drafts are decoded at 160x90 grey, 6 fps, and compared at the same time. A partial draft
(out/<draft>_span.json `{"t0": 56.2}`) is placed at its start and compared with the newest earlier draft covering each
moment. Add `review/changes_<draft>.manual.json` (same format) for changes a thumbnail can't see.
The heatmap counts, per half second, how many earlier drafts changed that spot; red is where the work keeps returning.

A draft still rendering: write `out/<draft>.rendering.json` (`{"label": "Draft 4", "started": <ms epoch>}`) when the
render starts. The page lists it first and shows progress bars from a render board at localhost:4477/runs, if one
is running. add_draft.py removes the marker.

## Reading the notes

Before any new work on a video, read every `review/notes_*.json` and `review/verdicts_*.json`. The user often
leaves notes without saying so in chat. Go through them one by one:

- `frame`, `time` (song time), `shot`, `line` (what was being sung), `text`.
- `rects`: boxes the user drew, `[{x, y, w, h}]` as fractions of the frame from the top-left.
- `img`: the frame with the numbered boxes drawn. **Open it before building the fix.** The box shows what the words
  only hint at.
- Verdicts: `"draft3:1730000000000": "broken"` means a note from draft 3 is still broken in this draft. Fix those first.

When you send the next draft, say which notes it addresses. The user marks them fixed or still broken in the
**Earlier rounds** tab.

## What the user can do on the page

- Space play/pause, ←/→ one frame, Shift+←/→ one second, `n` to type a note, Enter saves, Esc back to the video.
- Paused: drag on the picture to draw a box; drag again for more. **Right-click a box to remove it**; Backspace
  removes the last one, Clear boxes removes them all.
- Timeline: gold dots are this draft's notes, grey are earlier rounds (green fixed, red still broken), the cyan strip
  is this draft's changes, the amber-to-red band is the heatmap. Click anything to jump. `c` / Shift+C hop between changes.
- Tabs: This draft, Earlier rounds (accept or mark still broken), Changes (click to watch each from 1.5 s before).
- Click an earlier note that has a marked frame: a **before/after wipe** lays that frame (with its boxes) over this
  draft at the same moment; drag across to compare, Esc or play to close. Point the user at it when a draft answers a note.
- Several videos in one project (a main cut, a P.S., Shorts) get one tab each, from the `<piece>-draftN` names.

## API (for scripts)

`GET /api/drafts`, `/api/meta?draft=`, `/api/notes?draft=`, `/api/history?draft=`, `/api/changes?draft=`,
`/api/heat?draft=`, `/api/progress?draft=`, `/api/pieces`; `POST /api/notes`, `/api/delete`, `/api/verdict`,
`/api/done`. `GET /out/<file>` serves video with Range support.
