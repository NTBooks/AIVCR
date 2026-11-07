"""timeline.json + words/ -> edit.srt: subtitles in output time, short lines (up to ~42 characters, 3.2 s), words only from the
pieces that made the cut. fixes.json fixes what whisper mishears, as [regex, replacement] pairs applied to each line:
  [["\\bclawed\\b", "Claude"], ["\\bf f mpeg\\b", "ffmpeg"]]
usage: python make_srt.py [project dir]"""
import json, pathlib, re, sys

R = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else ".")
tl = json.loads((R / "timeline.json").read_text(encoding="utf8"))["segments"]
FIX = json.loads((R / "fixes.json").read_text(encoding="utf8")) if (R / "fixes.json").exists() else []
W = {}
words = []
for s in tl:
    if s["take"] not in W: W[s["take"]] = json.loads((R / "words" / f"{s['take']}.json").read_text(encoding="utf8"))
    for w in W[s["take"]]:
        mid = (w["s"] + w["e"]) / 2
        if s["in"] <= mid < s["out"]:
            words.append((s["start"] + max(0, w["s"] - s["in"]), s["start"] + min(s["dur"], w["e"] - s["in"]), w["w"]))
lines, cur = [], []
for w in words:
    text = " ".join(x[2] for x in cur + [w])
    if cur and (len(text) > 42 or w[1] - cur[0][0] > 3.2 or w[0] - cur[-1][1] > 0.6):
        lines.append(cur); cur = []
    cur.append(w)
    if w[2] and w[2][-1] in ".?!" and len(" ".join(x[2] for x in cur)) > 14: lines.append(cur); cur = []
if cur: lines.append(cur)
def ts(t): ms = int(round(t * 1000)); return f"{ms // 3600000:02d}:{ms // 60000 % 60:02d}:{ms // 1000 % 60:02d},{ms % 1000:03d}"
out = []
for i, L in enumerate(lines, 1):
    text = " ".join(x[2] for x in L)
    for a, b in FIX: text = re.sub(a, b, text, flags=re.I)
    end = min(L[-1][1] + 0.4, lines[i][0][0] - 0.05) if i < len(lines) else L[-1][1] + 0.4
    out.append(f"{i}\n{ts(L[0][0])} --> {ts(end)}\n{text}\n")
(R / "edit.srt").write_text("\n".join(out), encoding="utf8")
print(f"edit.srt: {len(out)} lines")
