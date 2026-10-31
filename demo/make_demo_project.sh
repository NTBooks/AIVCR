#!/bin/sh
# Builds the demo project for the README GIF: three drafts of a made-up 20 s video, with shots, lyrics and a few notes
# from earlier rounds. usage: sh demo/make_demo_project.sh <project dir>
set -e
P="$1"; S="$(dirname "$0")/../skills/review-harness/scripts"; T="$P/tmp"
mkdir -p "$P/player" "$P/out" "$P/review" "$T"
# a 20 s coast drive in five 4 s shots, each a slow camera move over a still made with Nano Banana (demo/stills,
# prompts in demo/prompts). Draft 2 adds the tree the draft 1 notes asked for; draft 3 turns the cliff road to night.
ST="$(dirname "$0")/stills"
shot() {   # still, push (+1 in, -1 out), drift in px per frame, out
  ffmpeg -v error -y -loop 1 -framerate 30 -t 4 -i "$1" -vf "scale=2752:1536,zoompan=z='1.035+$2*0.035*(on/60-1)':x='iw/2-(iw/zoom/2)+$3*on':y='ih/2-(ih/zoom/2)':d=1:s=1280x720:fps=30,format=yuv420p" \
    -c:v libx264 -crf 18 -t 4 "$4"
}
draft() {   # tree shot, cliff shot, out
  shot "$ST/s1.jpg" 1 1.2 "$T/a.mp4"; shot "$ST/$1.jpg" 1 -1 "$T/b.mp4"; shot "$ST/s3.jpg" 1 0 "$T/c.mp4"
  shot "$ST/$2.jpg" 1 0 "$T/d.mp4"; shot "$ST/s5.jpg" -1 0 "$T/e.mp4"
  ffmpeg -v error -y -i "$T/a.mp4" -i "$T/b.mp4" -i "$T/c.mp4" -i "$T/d.mp4" -i "$T/e.mp4" -f lavfi -t 20 -i anullsrc=r=48000:cl=stereo \
    -filter_complex "[0][1][2][3][4]concat=n=5:v=1:a=0[v]" -map "[v]" -map 5 -c:v libx264 -crf 18 -pix_fmt yuv420p -c:a aac -shortest "$3"
}
draft s2a s4a "$T/d1.mp4"
draft s2b s4a "$T/d2.mp4"
draft s2b s4b "$T/d3.mp4"
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
cat > "$P/review/notes_draft1.json" <<'EOF'
[{"id": 1700000000001, "frame": 165, "time": 5.5, "shot": "tree", "line": "past the tree we planted", "text": "The lyric says a tree but there's no tree. Put one by the road."},
 {"id": 1700000000002, "frame": 405, "time": 13.5, "shot": "nightfall", "line": "night comes down like a curtain", "text": "Night should actually fall here, it stays daytime."}]
EOF
cat > "$P/review/notes_draft2.json" <<'EOF'
[{"id": 1700000000003, "frame": 420, "time": 14.0, "shot": "nightfall", "line": "night comes down like a curtain", "text": "Still no night. Darken it and add a moon."}]
EOF
REVIEW_ROOT="$P" python "$S/changes.py" --all
echo "demo project ready: $P"
