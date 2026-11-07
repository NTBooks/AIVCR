---
name: talk-edit
description: Edit a talking-head or screen-recording video (a vlog, a tutorial, a confessional, a talk) from raw takes to a finished cut with no timeline editor - check the takes, transcribe every word with timestamps, plan the cut from the transcript, cut on real silences with air at every edge, tighten long pauses, cut out mic dropouts, crossfade the joins, centre and level the voice to -14 LUFS, blur private info, make subtitles, then refine it in review rounds on the review page. Use it when someone hands over recordings of themselves talking and wants an edited video, says "cut the ums", "tighten the pauses", "edit my talk/vlog/tutorial", "make subtitles", or wants a video made "without Premiere".
---

# Talk edit

The person talks; Claude cuts. Every cut is still theirs to approve: they review drafts on the review page (the
**review-harness** skill in this repo) and their notes drive the next draft.

Needs: ffmpeg on the PATH, Python 3 with `numpy` and `faster-whisper` (`pip install numpy faster-whisper`).

## A project folder
```
takes.txt      one line per recording:  c1 C:/Videos/take1.mp4     (short names; the cut refers to them)
prompt.txt     optional: names and words for whisper to spell right ("Claude, ffmpeg, AIVCR")
plan.json      the cut: which pieces of which takes, in order (cut.py)
fixes.json     optional: [regex, replacement] pairs for subtitles whisper still gets wrong
blur.json      optional: boxes to blur, [take, t0, t1, x, y, w, h] in take seconds and pixels
```

## Steps
1. **Check the takes right after recording**, while a line can still be redone:
   `python scripts/check_takes.py --takes takes.txt`. It lists mic dropouts (exit 1 with a REDO list), clicks, samples
   at full scale (turn the gain down) and a lopsided left/right balance (fixed later, no redo).
2. **Transcribe:** `python scripts/transcribe.py` writes `words/<take>.json` (every word with its start and end) and
   `transcript_<take>.txt` to read.
3. **Plan the cut with the person.** Read the transcript; propose what to keep and what to drop (false starts,
   repeated lines, rambles, dead air), with the times. They decide. Write it into `plan.json`:
   ```json
   { "fps": 30, "min_pause": 1.3,
     "pieces": [ {"take": "c1", "in": 0.5, "out": 94.8, "note": "the intro"},
                 {"take": "c1", "in": 103.8, "out": 573.6, "exact_out": true, "note": "keeps the gesture after the last word"} ] }
   ```
   Uncut is a valid choice too (one piece, `"tighten": false`): some talks are about honesty and read worse cut.
4. **Cut:** `python scripts/cut.py` writes `timeline.json`. The rules it follows:
   - edges only in real silence, found on the audio itself, never on whisper's word times (they run 0.1-0.2 s off, and a
     cut placed from them clips the ends of words);
   - 0.24 s of air after the last word and 0.16 s before the first, so cuts never feel abrupt;
   - pauses of `min_pause` s or more are tightened, keeping 0.45 s after the speech and 0.40 s before the next (cutting
     too close and too often is the commonest complaint);
   - mic dropouts (runs of digital silence) are cut out;
   - every piece is a whole number of frames, so anything laid over the picture stays in sync to the end.
5. **Build:** `python scripts/build.py` writes `edit.mp4`: the picture piece by piece (with `blur.json`'s boxes), the
   sound with crossfaded joins over a faint loop of the room's own tone (no join drops to dead silence), then
   `level_audio.py`: the voice folded to centred mono (some mics record one channel louder, which sounds lopsided),
   a high-pass at 80 Hz, a limiter, and a single steady boost to -14 LUFS (YouTube's level). It stops rather than let
   loudnorm ride the gain.
6. **Subtitles:** `python scripts/make_srt.py` writes `edit.srt` from the words that made the cut, in short lines.
7. **Review:** add the draft to the review page (`python ../review-harness/scripts/add_draft.py <project> edit.mp4`),
   give the person the link, and wait for their notes. Read every note and its marked-up frame before changing anything.
   Edit `plan.json`, re-run 4-6, add the next draft. The page shows what changed and where the work keeps returning.

## Privacy, before anyone sees a cut
Screen recordings leak: email addresses, address bars, private links, other people's messages. Look through every
screen-recorded stretch (pause on each screen change) and add a `blur.json` box for each. If a private link ever showed in
a take, treat it as public: revoke it.

## Mistakes on camera
Keep the take flowing. When the person states something wrong, the usual fix is to keep their line and add a short
on-screen correction (a caption, a small card), not a re-record. Fact-check claims with the person before recording.

## Graphics and extras (optional)
Cards, lower thirds, diagrams and screenshots go in the empty parts of the frame (a blank wall, a dark column beside a
screen share), never over the face or the hands, and never zoom in on someone who talks with their hands. Any tool works:
ask Claude to build them as code (Remotion, HTML rendered with Playwright) or as PNG/MOV files, keyed to times in
`timeline.json` (a take second maps to output time through its piece's `in` and `start`). Composite them over `edit.mp4`
with ffmpeg's `overlay`.

## Saying where the AI went
The video should say how it was made, on screen or in the description. The **slop-o-meter** skill in this repo makes a
card that scores it out of 100: a talk that is mostly the person on camera scores low.

## Files
- `scripts/check_takes.py`: takes report (dropouts, clicks, clipping, balance).
- `scripts/transcribe.py`: words with timestamps per take.
- `scripts/cut.py`: plan.json -> timeline.json (the edge rules above).
- `scripts/build.py`: timeline.json -> edit.mp4 (picture, crossfaded sound, levelling).
- `scripts/level_audio.py`: centred mono, -14 LUFS, linear or nothing.
- `scripts/make_srt.py`: subtitles.
