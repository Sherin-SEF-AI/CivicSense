#!/usr/bin/env bash
# Renders the synthetic evidence media. Run with `npm run media`.
#
# The forensics stage has to prove frame-accurate stepping and four-way sync, and
# it cannot prove that against a canvas that fakes it. So the clips are real
# H.264 files with a burned-in timecode and frame counter: if the tiles are out
# of step, the numbers on screen disagree and you can see it.
set -euo pipefail

OUT="public/media"
CLIPS="$OUT/clips"
FRAMES="$OUT/frames"
THUMBS="$OUT/thumbs"
mkdir -p "$CLIPS" "$FRAMES" "$THUMBS"

FONT="/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"
DUR=60
FPS=25
W=640
H=360

# label, road tint, vehicle count, direction
CLIPS_SPEC=(
  "CAM north approach|0x171A1F|4|1"
  "CAM south approach|0x14171B|3|-1"
  "PATROL forward|0x1A1E23|5|1"
  "BWC officer view|0x101317|2|-1"
)

i=1
for spec in "${CLIPS_SPEC[@]}"; do
  IFS='|' read -r LABEL TINT NVEH DIR <<< "$spec"
  echo "clip-$i  $LABEL"

  # Perspective-ish lane guides, then vehicles moving along them.
  FILTER="drawbox=x=0:y=0:w=${W}:h=${H}:color=${TINT}:t=fill"
  FILTER="$FILTER,drawbox=x=0:y=200:w=${W}:h=160:color=0x0B0D10:t=fill"
  for lane in 0 1 2; do
    Y=$((215 + lane * 45))
    FILTER="$FILTER,drawbox=x=0:y=${Y}:w=${W}:h=1:color=0x2A313A@0.55:t=fill"
  done

  v=0
  while [ "$v" -lt "$NVEH" ]; do
    LANE=$((v % 3))
    Y=$((222 + LANE * 45))
    SPEED=$((70 + v * 26))
    OFFSET=$((v * 170))
    BW=$((44 + v * 7))
    if [ "$DIR" = "1" ]; then
      X="mod(t*${SPEED}+${OFFSET}\,900)-120"
    else
      X="820-mod(t*${SPEED}+${OFFSET}\,900)"
    fi
    COLOR=$(printf '0x%02X%02X%02X' $((120 + v * 25)) $((124 + v * 18)) $((132 + v * 12)))
    FILTER="$FILTER,drawbox=x='${X}':y=${Y}:w=${BW}:h=22:color=${COLOR}:t=fill"
    FILTER="$FILTER,drawbox=x='${X}':y=${Y}:w=${BW}:h=22:color=0xE8EAED@0.35:t=1"
    v=$((v + 1))
  done

  # A pedestrian crossing the frame once, so there is a conflict to measure.
  FILTER="$FILTER,drawbox=x=${W}/2-6:y='330-mod(t*11\,150)':w=10:h=18:color=0xD29922:t=fill"

  # Burned-in timecode, frame number and source label, all monospace.
  FILTER="$FILTER,drawtext=fontfile=${FONT}:text='%{pts\\:hms}':x=8:y=8:fontsize=18:fontcolor=0xE8EAED:box=1:boxcolor=0x000000@0.55:boxborderw=5"
  FILTER="$FILTER,drawtext=fontfile=${FONT}:text='f %{n}':x=8:y=32:fontsize=14:fontcolor=0x58A6FF:box=1:boxcolor=0x000000@0.55:boxborderw=4"
  FILTER="$FILTER,drawtext=fontfile=${FONT}:text='${LABEL}':x=${W}-tw-8:y=8:fontsize=14:fontcolor=0x9AA3AD:box=1:boxcolor=0x000000@0.55:boxborderw=4"

  ffmpeg -y -loglevel error \
    -f lavfi -i "color=c=black:s=${W}x${H}:r=${FPS}:d=${DUR}" \
    -vf "$FILTER" \
    -c:v libx264 -profile:v main -pix_fmt yuv420p -crf 30 \
    -g "$FPS" -keyint_min "$FPS" -sc_threshold 0 \
    -movflags +faststart \
    "$CLIPS/clip-$i.mp4"
  i=$((i + 1))
done

# An HLS ladder off the first clip, so the live-stream path is exercised too.
mkdir -p "$OUT/hls"
ffmpeg -y -loglevel error -i "$CLIPS/clip-1.mp4" \
  -c:v libx264 -crf 32 -g "$FPS" -keyint_min "$FPS" -sc_threshold 0 \
  -f hls -hls_time 4 -hls_playlist_type vod \
  -hls_segment_filename "$OUT/hls/seg-%03d.ts" "$OUT/hls/live.m3u8"

# Keyframes per source family, pulled from the clips at spaced offsets.
extract() {
  local family=$1 clip=$2 label=$3
  for n in 1 2 3 4 5 6; do
    local ts=$(( (n - 1) * 9 + 2 ))
    ffmpeg -y -loglevel error -ss "$ts" -i "$CLIPS/clip-$clip.mp4" -frames:v 1 \
      -vf "scale=1280:720:flags=bicubic,drawtext=fontfile=${FONT}:text='${label} ${n}':x=16:y=h-40:fontsize=22:fontcolor=0x9AA3AD:box=1:boxcolor=0x000000@0.5:boxborderw=6" \
      -q:v 6 "$FRAMES/${family}-${n}.jpg"
  done
}

extract cam 1 "fixed camera"
extract bodycam 4 "bodycam"
extract patrol 3 "patrol camera"
extract sensor 2 "sensor site"
extract usb 2 "shop camera"

# Fleet thumbnails for the sources screen.
for n in 1 2 3 4 5 6 7 8; do
  ffmpeg -y -loglevel error -ss $(( n * 5 )) -i "$CLIPS/clip-$(( (n % 4) + 1 )).mp4" -frames:v 1 \
    -vf "scale=320:180" -q:v 8 "$THUMBS/cam-$n.jpg"
done
for n in 1 2 3; do
  cp "$THUMBS/cam-$n.jpg" "$THUMBS/patrol-$n.jpg"
  cp "$THUMBS/cam-$(( n + 3 )).jpg" "$THUMBS/usb-$n.jpg"
done

du -sh "$OUT"
ls "$CLIPS" "$FRAMES" | head -20
