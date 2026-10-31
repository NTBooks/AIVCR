#!/bin/sh
# demo recording -> README GIF: 900 px wide, 12 fps, one palette for the whole clip.
# usage: sh demo/to_gif.sh demo/out/demo.mp4 assets/demo.gif [skip seconds]
set -e
IN="$1"; OUT="$2"; SS="${3:-0}"
F="fps=12,scale=900:-1:flags=lanczos"
ffmpeg -v error -y -ss "$SS" -i "$IN" -vf "$F,palettegen=max_colors=256:stats_mode=diff" /tmp/aivcr_palette.png
ffmpeg -v error -y -ss "$SS" -i "$IN" -i /tmp/aivcr_palette.png -lavfi "$F[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle" "$OUT"
ls -la "$OUT"
