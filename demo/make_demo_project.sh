#!/bin/sh
# Builds the demo project for the README GIF: three drafts of a made-up 20 s video, with shots, lyrics and a few notes
# from earlier rounds. usage: sh demo/make_demo_project.sh <project dir>
set -e
P="$1"; S="$(dirname "$0")/../skills/review-harness/scripts"; T="$P/tmp"
mkdir -p "$P/player" "$P/out" "$P/review" "$T"
# one scene: a dusk sky, a sun, a hill and a little car driving across; $1 = what this draft adds
draft() {
  ffmpeg -v error -y -f lavfi -i "gradients=s=1280x720:c0=0x1b1035:c1=0xff7a59:x0=0:y0=0:x1=0:y1=720:d=20:speed=0.004:seed=7:r=30" \
    -f lavfi -i "sine=f=220:d=20" -f lavfi -i "color=c=black:s=170x96:d=20:r=30" -filter_complex "[2]drawbox=x=35:y=4:w=100:h=40:color=0x3cc8ff:t=fill,drawbox=x=50:y=12:w=70:h=24:color=0xbfefff:t=fill,drawbox=x=0:y=38:w=170:h=40:color=0x3cc8ff:t=fill,drawbox=x=22:y=66:w=34:h=28:color=0x222222:t=fill,drawbox=x=114:y=66:w=34:h=28:color=0x222222:t=fill,colorkey=black:0.01[car];[0]drawbox=x=0:y=520:w=1280:h=200:color=0x2a3b2a:t=fill,drawbox=x=880:y=140:w=120:h=120:color=0xffd36b:t=fill$1[bg];[bg][car]overlay=x='-180+t*75':y=430[v]" \
    -map "[v]" -map 1 -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest "$2"
}
TREE=",drawbox=x=290:y=360:w=60:h=170:color=0x6b4423:t=fill:enable='between(t,4,8)',drawbox=x=210:y=200:w=220:h=190:color=0x2f8a3a:t=fill:enable='between(t,4,8)'"
NIGHT=",drawbox=x=0:y=0:w=1280:h=720:color=0x05061a@0.55:t=fill:enable='between(t,12,16)',drawbox=x=300:y=120:w=60:h=60:color=0xf2f2ff:t=fill:enable='between(t,12,16)'"
draft "" "$T/d1.mp4"
draft "$TREE" "$T/d2.mp4"
draft "$TREE$NIGHT" "$T/d3.mp4"
for n in 1 2 3; do python "$S/add_draft.py" "$P" "$T/d$n.mp4" draft$n; done
rm -rf "$T"
cat > "$P/player/lines.json" <<'EOF'
[{"t0": 0.5, "t1": 4, "text": "Rolling down the hill road"}, {"t0": 4, "t1": 8, "text": "past the tree we planted"},
 {"t0": 8, "t1": 12, "text": "sun is low and golden"}, {"t0": 12, "t1": 16, "text": "night comes down like a curtain"},
 {"t0": 16, "t1": 19.5, "text": "and the little car keeps going"}]
EOF
for n in 1 2 3; do cat > "$P/out/draft${n}_shots.json" <<'EOF'
[{"name": "drive-in", "set": "hill", "t0": 0, "t1": 4}, {"name": "tree", "set": "hill", "t0": 4, "t1": 8},
 {"name": "golden", "set": "hill", "t0": 8, "t1": 12}, {"name": "nightfall", "set": "hill", "t0": 12, "t1": 16},
 {"name": "drive-out", "set": "hill", "t0": 16, "t1": 20}]
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
