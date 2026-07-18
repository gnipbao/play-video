#!/usr/bin/env bash
# dump_events.sh <url> <out.json>
# headless Chrome 打开 ?dump=1 页面,等 __AUDIO__ 行出现后强杀,抠出事件 JSON。
# 注意:headless Chrome 不会自己退出,必须限时强杀。
set -euo pipefail

URL="$1"; OUT="$2"
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
LOG=$(mktemp); PROF=$(mktemp -d)

"$CHROME" --headless=new --disable-gpu --no-first-run \
  --user-data-dir="$PROF" --enable-logging=stderr --v=0 "$URL" >"$LOG" 2>&1 &
PID=$!
for _ in $(seq 1 90); do
  grep -q "__AUDIO__" "$LOG" 2>/dev/null && break
  sleep 1
done
kill "$PID" 2>/dev/null || true
sleep 1
pkill -f "$PROF" 2>/dev/null || true

python3 - "$LOG" "$OUT" <<'EOF'
import json, sys
raw = open(sys.argv[1], errors="replace").read()
i = raw.index("__AUDIO__") + len("__AUDIO__")
events, _ = json.JSONDecoder().raw_decode(raw[i:].lstrip('"'))
json.dump(events, open(sys.argv[2], "w"))
from collections import Counter
print(len(events), dict(Counter(e["type"] for e in events)), "→", sys.argv[2])
EOF

rm -rf "$PROF" "$LOG"
