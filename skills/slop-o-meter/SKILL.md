---
name: slop-o-meter
description: Make a "Slop-o-meter" AI-use disclosure card for a video, song, game or app - a brass ship's gauge whose ship's log types out where and how AI was used (one line per use, level pips and points), the needle kicking up with each line, a rolling odometer, slop rising in a trough, and a rubber-stamped verdict (HAND-RAISED to PURE TROUGH), scored out of 100 against the most AI the work could have used, rendered as a 1080p mp4 with synthesised sound. Also writes the matching "where the AI went" block for a video description. Use it whenever the user wants a slop-o-meter, an AI-use disclosure, a "how much AI is in this" card or intro, or a slop score for something they made.
---

# Slop-o-meter: how much AI went into this?

A 12-15 s 1920x1080 card. The ship's log lists **where and how AI was used**; each line kicks the gauge's needle up by
its points; the score is **out of 100 = all the AI the work could have used**; the verdict is stamped at the end.
Everything is drawn in code (Canvas 2D, a pure function of t), so a card costs nothing and renders in seconds.
There's a web version at https://slopscore.org/slop-o-meter/ that makes the same card in the browser.

Files: `rubric.json` (categories, weights, levels, verdicts), `player/` (the card: `index.html` + `meter-core.js`),
`scripts/render.mjs` (frames + sound to mp4, or stills), `scripts/sfx.py` (synthesised sound), `scripts/score.py` (checks a
log, prints the score and the description block), `examples/example.json` (a filled-in log: 62.5, CERTIFIED SLOP).
First time: `npm install` and `npx playwright install chromium` in this folder; rendering also needs `ffmpeg` and
Python 3 with numpy.

## The scoring
The most AI is **AI written, AI directed, generated video, generated audio**; less is adding sound effects or motion
graphics; the least is audio mastering. `python scripts/score.py --rubric` prints the table:

| Tier | Category (`cat`) | Weight |
|---|---|---|
| 1 | `writing` lyrics & script · `direction` direction & edit · `video` generated video · `audio` generated music & vocals | 15 each |
| 2 | `images` generated images 10 · `code` animation & render code 8 | |
| 3 | `helpers` depth/masks/flow 5 · `mograph` motion graphics & lyric timing 5 · `sfx` sound effects 4 · `research` research & AI critics 3 | |
| 4 | `cleanup` audio cleanup & stems 3 · `mastering` audio mastering 2 | |

Each use gets a **level**: 0 none, 0.25 a touch, 0.5 half, 0.75 mostly, 1 all AI. Points = weight x level; the score is
the sum. Verdicts: 0 HAND-RAISED, 10 A PINCH OF SLOP, 30 SLOP-ADJACENT, 50 CERTIFIED SLOP, 70 PRIME SLOP, 90 PURE TROUGH.
To change a weight or a verdict, edit `rubric.json` (the gauge's colour bands follow the verdicts).

**Scale every level by the share of the finished work it covers.** Overlays on a talk that is mostly the person on
camera rarely go past half; direction is a touch when the person chose the cuts.

Guides (check each against the project, never assume):
- **audio**: a song generated whole (Suno, Udio) is 1. The person's own voice or instrument on top lowers it. If they
  brought a melody, a hummed or played demo, chords or a recording into the generator, it's less than 1: ask.
- **writing**: never score it from the project files; it comes from the interview. The person's own words 0, their
  words with AI tidy-ups 0.25, written together from their brief and edits 0.5, AI drafting from a one-line idea 0.75,
  AI unprompted 1.
- **direction**: the AI builds the shots and the person gives rounds of notes: 0.5. Fewer notes, higher.
- **video**: text/image-to-video models (Veo, Sora, Kling, Runway) or an AI restyle of footage. Code-rendered animation
  (Three.js, Godot, Remotion, canvas) is NOT this; it's `code`.
- **images**: generated stills, plates, cast and sprite sheets = 1; a few props = 0.25; hand-made art, real photos = 0.
- **code**: the AI wrote the engine or animation = 1.
- **helpers**: depth plates, masks, flow = 1 when the style is built on them, 0.25 for a stray mask.
- **mograph**: whisper-timed karaoke lyrics = 1.
- **sfx**: synthesised or generated foley = 1; real recordings = leave it out.
- **research**: fact-checks and AI judges or critics: 0.25-0.75.
- **cleanup**: AI stem splitting, patched dropouts, spliced takes = 0.5-1.
- **mastering**: loudness levelling or an AI master.

## Making a card
1. **Interview the person about everything before the AI got involved.** The project files only show what the AI did;
   the idea, the words and the music often started earlier. Ask, one question at a time, before drafting rows:
   - **The words:** did you write them, write them with an AI, or did an AI draft them? Any lines that are all yours?
   - **The idea:** whose idea was it (theme, jokes, characters, story)?
   - **The music:** did anything of yours go into the generator: a melody, a demo, chords, an instrument? Who picked the take?
   - **Anything else by hand:** drawings, photos, footage, their voice, edits they made themselves.
   Their answers set `writing` and `audio`, and fill `human`.
2. **Gather the rest from the project:** release notes, style docs, image logs, which tools ran (whisper, stem
   splitting, depth maps, foley), how many rounds of notes. Their answer wins over your estimate.
3. **Write `slop.json`:**
   ```json
   { "title": "One-Shot Dummy", "byline": "a music video",
     "uses": [ { "cat": "audio", "level": 1, "text": "Song and vocals made in Suno v6 (take 12 of 12)" } ],
     "human": ["the idea", "the brief", "every note", "picking the take"] }
   ```
   One row per category used (merge two uses into one line). `text` is in the person's voice, first person, concrete
   (the tool, the count, the cost), at most 52 characters. `human` prints as BY HAND. Tier 1 and 2 categories not used
   print as NONE (that's where "no AI video" gets said). Options: `"order": "manifest"` keeps your row order (default:
   biggest points first), `"pace"` seconds per row (0.85), `"hold"` seconds on the stamp (3.2), `"noneTier"` (2).
4. **Check it:** `python scripts/score.py slop.json` prints the table, the score, warnings and the description block.
   Show the person the table and the score before rendering; they decide the levels.
5. **Stills, then the card:**
   ```
   node scripts/render.mjs slop.json --stills stills 0 6 13
   node scripts/render.mjs slop.json slop_o_meter.mp4
   ```
   Look at the last still (every row readable, nothing overlapping, the stamp legible), then render.
6. **Preview by scrubbing:** serve this folder (`python -m http.server 5199`) and open
   `player/index.html?m=examples/example.json`.
7. **Description:** paste score.py's block under the video's credits.

## Using it in a video
- After a spoken introduction and before the song, or at the end with a slide that explains it: "How much of this
  video did AI make? 0 = made by hand, 100 = all the AI it could have used."
- Lower the card's audio about 10 dB when it sits under speech; the bell is the cue that the song starts.
- Keep the first frame of the video the work's own title frame: the card is an insert, not the opener.
