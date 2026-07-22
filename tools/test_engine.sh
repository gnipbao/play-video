#!/usr/bin/env bash
# 零依赖回归:独立引擎 + 展示应用契约 + 空/非法事件静音音轨。
set -euo pipefail
cd "$(dirname "$0")/.."

node --test engine/test/engine.test.cjs
node --test web/test/app.test.cjs

if [ ! -L web/engine ] || [ "$(readlink web/engine)" != "../engine/src" ]; then
  echo "web/engine 必须是指向 ../engine/src 的展示应用挂载"
  exit 1
fi

while IFS= read -r -d '' script; do
  node --check "$script"
done < <(find engine/src web/scenes templates/scene -name '*.js' -print0)

TEST_TMP="$(mktemp -d)"
trap 'rm -rf "$TEST_TMP"' EXIT
printf '[]\n' > "$TEST_TMP/events.json"
python3 engine/tools/synth.py "$TEST_TMP/events.json" "$TEST_TMP/silence.wav" 0.2
python3 - "$TEST_TMP/silence.wav" <<'PY'
import sys
import wave

with wave.open(sys.argv[1], "rb") as wav:
    assert wav.getnchannels() == 2
    assert wav.getframerate() == 44100
    assert 0.19 <= wav.getnframes() / wav.getframerate() <= 0.21
print("OK empty audio")
PY

printf '[{"t":0.01,"type":"pluck","freq":440,"gain":0}]\n' > "$TEST_TMP/events.json"
python3 engine/tools/synth.py "$TEST_TMP/events.json" "$TEST_TMP/zero-gain.wav" 0.2
python3 - "$TEST_TMP/zero-gain.wav" <<'PY'
import sys
import wave

with wave.open(sys.argv[1], "rb") as wav:
    assert wav.getnchannels() == 2
    assert wav.getsampwidth() == 2
    assert wav.getframerate() == 44100
    assert 0.19 <= wav.getnframes() / wav.getframerate() <= 0.21
    frames = wav.readframes(wav.getnframes())
    assert frames and not any(frames)
print("OK zero-gain event skipped as silence")
PY
