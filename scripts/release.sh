#!/usr/bin/env bash
# Publishes every package whose version in package.json isn't on npm yet, from an up-to-date, clean main.
# Pass --dry-run to see what would be published without publishing. Uses your npm login.
set -euo pipefail

cd "$(dirname "$0")/.."
dry=""
[ "${1:-}" = "--dry-run" ] && dry="--dry-run"
[ "$(git branch --show-current)" = main ] || { echo "Switch to main first" >&2; exit 1; }
[ -z "$(git status --porcelain)" ] || { echo "Commit or stash your changes first" >&2; exit 1; }
git pull --quiet --ff-only

todo=()
for p in packages/*/; do
  name=$(node -p "require('./${p}package.json').name")
  version=$(node -p "require('./${p}package.json').version")
  [ -n "$(npm view "$name@$version" version 2>/dev/null)" ] || todo+=("$p")
done
[ ${#todo[@]} -gt 0 ] || { echo "Nothing to publish: every version is already on npm"; exit 0; }

for p in "${todo[@]}"; do
  echo "Publishing $(node -p "require('./${p}package.json').name")@$(node -p "require('./${p}package.json').version")"
  (cd "$p" && npm publish --access public $dry)
done
echo "Done. If npm holds them for approval, approve them on npmjs.com"
