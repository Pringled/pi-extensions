#!/bin/bash
# Records the browser half of the review demo for one theme and splices it into that theme's terminal recording.
# Usage: splice.sh <dark|light>, from the repo root after vhs recorded assets/images/pi-browser-review-<theme>.gif
set -euo pipefail
theme="$1"
dir=$(mktemp -d)
trap 'kill "$difit" 2>/dev/null; wait "$difit" 2>/dev/null; rm -rf "$dir"' EXIT
cp -R scripts/demo/stats "$dir/stats"
git -C "$dir/stats" init -q
git -C "$dir/stats" add .
git -C "$dir/stats" -c user.name=demo -c user.email=demo@example.com commit -qm "Add stats helpers and training script"
(cd "$dir/stats" && sh "$OLDPWD/scripts/demo/review/setup.sh")
(cd "$dir/stats" && exec difit . main --merge-base --no-open --keep-alive --clean > "$dir/difit.log" 2>&1) &
difit=$!
for _ in $(seq 1 30); do url=$(grep -oE "http://localhost:[0-9]+" "$dir/difit.log" | head -1) && [ -n "$url" ] && break; sleep 1; done
comment=$(node -e 'console.log(require("./scripts/demo/review/comments.json")[0].body)')
node scripts/demo/review/browser.mjs "$url" "$theme" "$comment" "$dir/browser"
uv run --quiet --with pillow python scripts/demo/review/compose.py "assets/images/pi-browser-review-$theme.gif" "$dir/browser" "assets/images/pi-browser-review-$theme.gif"
