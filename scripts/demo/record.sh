#!/usr/bin/env bash
# Records the README demos (assets/images/pi-*-{dark,light}.gif and .png) from the tapes in this folder.
# Pass demo names (polish, background, model-pick, context-bar) to record only those, and THEMES=dark or THEMES=light for one theme. Uses your pi login. Set PI_PREFIX to wrap pi in a sandbox, e.g. PI_PREFIX="nono run --profile pi --allow-cwd --allow $TMPDIR --".
set -euo pipefail

cd "$(dirname "$0")/../.."
command -v vhs >/dev/null || { echo "vhs not found, install it with: brew install vhs" >&2; exit 1; }
command -v pi >/dev/null || { echo "pi not found, see https://pi.dev" >&2; exit 1; }
agent="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"
[ -f "$agent/auth.json" ] || { echo "No pi login at $agent/auth.json, run pi and /login first" >&2; exit 1; }
provider="${DEMO_PROVIDER:-github-copilot}"
model="${DEMO_MODEL:-claude-opus-5.5}"
demos=("$@")
[ $# -eq 0 ] && demos=(polish background model-pick context-bar)

root=$(mktemp -d)
trap 'rm -rf "$root"' EXIT
# pi shows the real path of its working directory, so resolve symlinks for the footer to read ~/stats
root=$(cd "$root" && pwd -P)

# Load the packages from a copy next to the demo homes, so a sandbox only needs access to the temp folder
(cd packages/pi-polish && npm install --omit=peer --no-audit --no-fund --silent)
cp -R packages "$root/packages"
export PI_PREFIX="${PI_PREFIX:-}"
export PI_FLAGS="--no-session --no-extensions -e $root/packages/pi-polish -e $root/packages/pi-background -e $root/packages/pi-model-pick -e $root/packages/pi-context-bar"

# Each demo and theme gets its own $HOME with a fresh copy of the stats project and only these extensions loaded.
# The light tapes are the dark ones with the light style and file names.
pids=()
for theme in ${THEMES:-dark light}; do for demo in "${demos[@]}"; do
  home="$root/$theme/$demo"
  mkdir -p "$home/.pi/agent"
  ln -s "$agent/auth.json" "$home/.pi/agent/auth.json"
  # Reuse pi's fd and rg so a fresh home doesn't download them on screen
  [ -d "$agent/bin" ] && ln -s "$agent/bin" "$home/.pi/agent/bin"
  cat > "$home/.pi/agent/settings.json" <<EOF
{"quietStartup": true, "theme": "$theme", "defaultProvider": "$provider", "defaultModel": "$model", "defaultThinkingLevel": "medium", "hideThinkingBlock": true}
EOF
  cat > "$home/.pi/agent/model-picker-state.json" <<EOF
{"favorites": ["$provider/claude-sonnet-5.5", "$provider/claude-opus-5.5"], "recents": ["$provider/gpt-6.1-sol", "$provider/claude-haiku-5.5"]}
EOF
  cp -R scripts/demo/stats "$home/stats"
  git -C "$home/stats" init -q
  git -C "$home/stats" add .
  git -C "$home/stats" -c user.name=demo -c user.email=demo@example.com commit -qm "Add stats helpers and training script"
  sed "s/-dark\./-$theme./g" "scripts/demo/$demo.tape" > "$root/$theme-$demo.tape"
  DEMO_HOME="$home" vhs "$root/$theme-$demo.tape" >/dev/null &
  pids+=($!)
done; done
for pid in "${pids[@]}"; do wait "$pid"; done
echo "Recorded ${demos[*]} (${THEMES:-dark light}) to assets/images"
