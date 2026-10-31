#!/bin/sh
# Builds the demo project for the README GIF: three drafts of a made-up 20 s coast drive. Only draft 1 is on the review
# page; drafts 2 and 3 wait in <project>/staged/ and record_demo.mjs moves each one into out/ after the note that asks
# for it, the way Claude's next render would land. usage: sh demo/make_demo_project.sh <project dir>
#   draft 1: the cliff road in daylight      (note: "make it night")
#   draft 2: night, but a dull moon          (note: "brighter moon")
#   draft 3: a big bright moon on the water
set -e
P="$1"; S="$(dirname "$0")/../skills/review-harness/scripts"; T="$P/tmp"
mkdir -p "$P/player" "$P/out" "$P/review" "$P/staged" "$T"
# five 4 s shots, each a slow camera move over a still made with Nano Banana (demo/stills, prompts in demo/prompts)
ST="$(dirname "$0")/stills"
shot() {   # still, push (+1 in, -1 out), drift in px per frame, out
  ffmpeg -v error -y -loop 1 -framerate 30 -t 4 -i "$1" -vf "scale=2752:1536,zoompan=z='1.035+$2*0.035*(on/60-1)':x='iw/2-(iw/zoom/2)+$3*on':y='ih/2-(ih/zoom/2)':d=1:s=1280x720:fps=30,format=yuv420p" \
    -c:v libx264 -crf 18 -t 4 "$4"
}
draft() {   # cliff shot, out
  shot "$ST/s1.jpg" 1 1.2 "$T/a.mp4"; shot "$ST/s2b.jpg" 1 -1 "$T/b.mp4"; shot "$ST/s3.jpg" 1 0 "$T/c.mp4"
  shot "$ST/$1.jpg" 1 0 "$T/d.mp4"; shot "$ST/s5.jpg" -1 0 "$T/e.mp4"
  ffmpeg -v error -y -i "$T/a.mp4" -i "$T/b.mp4" -i "$T/c.mp4" -i "$T/d.mp4" -i "$T/e.mp4" -f lavfi -t 20 -i anullsrc=r=48000:cl=stereo \
    -filter_complex "[0][1][2][3][4]concat=n=5:v=1:a=0[v]" -map "[v]" -map 5 -c:v libx264 -crf 18 -pix_fmt yuv420p -c:a aac -shortest "$2"
}
draft s4a "$T/d1.mp4"
draft s4d "$T/d2.mp4"
draft s4b "$T/d3.mp4"
for n in 1 2 3; do python "$S/add_draft.py" "$P" "$T/d$n.mp4" draft$n; done
rm -rf "$T"
cat > "$P/player/lines.json" <<'EOF'
[{"t0": 0.5, "t1": 4, "text": "Rolling down the coast road"}, {"t0": 4, "t1": 8, "text": "past the tree we planted"},
 {"t0": 8, "t1": 12, "text": "sun is low and golden"}, {"t0": 12, "t1": 16, "text": "night comes down like a curtain"},
 {"t0": 16, "t1": 19.5, "text": "and the little car keeps going"}]
EOF
for n in 1 2 3; do cat > "$P/out/draft${n}_shots.json" <<'EOF'
[{"name": "drive-in", "set": "coast", "t0": 0, "t1": 4}, {"name": "tree", "set": "coast", "t0": 4, "t1": 8},
 {"name": "golden", "set": "coast", "t0": 8, "t1": 12}, {"name": "nightfall", "set": "coast", "t0": 12, "t1": 16},
 {"name": "drive-out", "set": "coast", "t0": 16, "t1": 20}]
EOF
done
REVIEW_ROOT="$P" python "$S/changes.py" --all
# hold drafts 2 and 3 back until their notes are written
for n in 2 3; do mv "$P"/out/draft${n}.mp4 "$P"/out/draft${n}_* "$P/staged/"; done
echo "demo project ready: $P (draft 1 on the page, drafts 2-3 staged)"
