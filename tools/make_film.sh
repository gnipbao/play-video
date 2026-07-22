#!/usr/bin/env bash
# make_film.sh <record_page> <out.mp4> [fps] [quality]
# 一条命令出片:hyperframes 渲染 → 导出音轨事件 → 离线合成 → ffmpeg 混音
# 例:tools/make_film.sh record.html demo/control.mp4
#    tools/make_film.sh scenes/sparks/record.html demo/sparks.mp4
set -euo pipefail
cd "$(dirname "$0")/.."

PAGE="${1:?用法: make_film.sh <record_page> <out.mp4> [fps] [quality]}"
OUT="${2:?用法: make_film.sh <record_page> <out.mp4> [fps] [quality]}"
FPS="${3:-30}"
QUALITY="${4:-high}"
OUT_DIR="$(dirname "$OUT")"
SILENT="${OUT%.mp4}_silent.mp4"
EVENTS="${OUT%.mp4}_audio_events.json"
WAV="${OUT%.mp4}_soundtrack.wav"
PORT="${PORT:-8123}"
SERVER_PID=""

[ -f "web/$PAGE" ] || { echo "找不到录制页面: web/$PAGE"; exit 1; }
[[ "$FPS" =~ ^[1-9][0-9]*$ ]] || { echo "fps 必须是正整数"; exit 1; }
mkdir -p "$OUT_DIR"

cleanup() {
  if [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

# hyperframes 二进制发现:PATH → 已知 fallback
HF=$(command -v hyperframes || true)
if [ -z "$HF" ]; then
  for cand in /Users/chenyaru/Playground/Reelforge/node_modules/.bin/hyperframes; do
    [ -x "$cand" ] && HF="$cand" && break
  done
fi
[ -n "$HF" ] || { echo "找不到 hyperframes,请先安装(npm i -g hyperframes 或项目内依赖)"; exit 1; }

# 本地 http(web/ 根,渲染页与 dump 都走它)
if ! curl -s -o /dev/null "http://localhost:$PORT/index.html"; then
  tools/serve.py "$PORT" >/dev/null 2>&1 &
  SERVER_PID=$!
  for _ in {1..30}; do
    curl -s -o /dev/null "http://localhost:$PORT/index.html" && break
    sleep 0.1
  done
  curl -s -o /dev/null "http://localhost:$PORT/index.html" \
    || { echo "本地服务启动失败: http://localhost:$PORT"; exit 1; }
fi

echo "▶ 1/4 渲染无声视频 $PAGE → $SILENT"
"$HF" render web -c "$PAGE" -o "$SILENT" -f "$FPS" -q "$QUALITY"

echo "▶ 2/4 导出音轨事件 → $EVENTS"
tools/dump_events.sh "http://localhost:$PORT/${PAGE}?dump=1" "$EVENTS"

echo "▶ 3/4 离线合成配乐 → $WAV"
VDUR=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$SILENT")
python3 engine/tools/synth.py "$EVENTS" "$WAV" "$VDUR"

echo "▶ 4/4 混音成片 → $OUT"
ffmpeg -loglevel error -i "$SILENT" -i "$WAV" -c:v copy -c:a aac -b:a 192k -y "$OUT"
echo "✓ 完成 → $OUT"
