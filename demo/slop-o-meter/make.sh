#!/usr/bin/env bash
# Remake the slop-o-meter pictures in the README: assets/slop-o-meter/{card.gif, card-final.png, generator.png}.
# Needs what the skill needs (npm install + npx playwright install chromium in skills/slop-o-meter, ffmpeg, python 3
# with numpy). Run from the repo root:  bash demo/slop-o-meter/make.sh
set -euo pipefail
SK=skills/slop-o-meter
OUT=assets/slop-o-meter
TMP=$(mktemp -d)
mkdir -p "$OUT"
node "$SK/scripts/render.mjs" "$SK/examples/example.json" "$TMP/card.mp4" 30
# 960 px at 15 fps with one shared palette; the last second holds on the stamp
ffmpeg -v error -y -i "$TMP/card.mp4" -vf "fps=15,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=160:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle" "$OUT/card.gif"
node "$SK/scripts/render.mjs" "$SK/examples/example.json" --stills "$TMP" 13.1
ffmpeg -v error -y -i "$TMP"/t_*.png -vf scale=1280:-1:flags=lanczos "$OUT/card-final.png"
node demo/slop-o-meter/shoot.mjs "$OUT"
rm -rf "$TMP"
ls -la "$OUT"
