#!/bin/bash
# Records the browser half of the feedback demo for one theme and splices it into that theme's terminal recording.
# Usage: splice.sh <dark|light>, from the repo root after vhs recorded assets/images/pi-feedback-<theme>.gif
set -euo pipefail
theme="$1"
dir=$(mktemp -d)
trap 'kill "$difit" "${proxy:-}" 2>/dev/null; wait 2>/dev/null; rm -rf "$dir"' EXIT
cp -R scripts/demo/stats "$dir/stats"
git -C "$dir/stats" init -q
git -C "$dir/stats" add .
git -C "$dir/stats" -c user.name=demo -c user.email=demo@example.com commit -qm "Add stats helpers and training script"
(cd "$dir/stats" && sh "$OLDPWD/scripts/demo/feedback/setup.sh")
(cd "$dir/stats" && exec difit . main --merge-base --no-open --keep-alive --clean > "$dir/difit.log" 2>&1) &
difit=$!
for _ in $(seq 1 30); do url=$(grep -oE "http://localhost:[0-9]+" "$dir/difit.log" | head -1) && [ -n "$url" ] && break; sleep 1; done
# Through the extension's own proxy, so the recording shows the real Send to Pi button
node --input-type=module -e "
	const { startProxy } = await import('$PWD/packages/pi-feedback/extensions/feedback.ts');
	const server = await startProxy(new URL('$url'), () => {});
	console.log('http://127.0.0.1:' + server.address().port);
" > "$dir/proxy.log" &
proxy=$!
for _ in $(seq 1 20); do page=$(head -1 "$dir/proxy.log") && [ -n "$page" ] && break; sleep 0.5; done
comment=$(node -e 'console.log(require("./scripts/demo/feedback/comments.json")[0].body)')
node scripts/demo/feedback/browser.mjs "$page" "$theme" "$comment" "$dir/browser"
uv run --quiet --with pillow python scripts/demo/feedback/compose.py "assets/images/pi-feedback-$theme.gif" "$dir/browser" "assets/images/pi-feedback-$theme.gif"
