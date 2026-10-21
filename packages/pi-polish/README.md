# pi-polish

Claude Code-style tool rows and diffs for [pi](https://pi.dev). Only the display changes; every tool runs exactly as it does in pi.

```bash
pi install npm:pi-polish
```

pi-polish patches some of pi's internal UI components, so a new pi release can break parts of the look until pi-polish is updated. Your tools and sessions are never affected; at worst the display looks off or falls back to pi's default. Last tested with pi 1.3.

## Features

- Consecutive `bash`, `read`, `grep`, `find` and `ls` calls fold into one live line (`Running 2 shell commands… · 5s`) that settles into a summary (`Ran 3 shell commands, read 2 files`).
- Edits show as diffs on red and green bands, highlighted with [Shiki](https://shiki.style) in VS Code Dark+ colors, with the changed words marked. New files show a preview of their first lines.
- The `●` before each row is green when it finished, red when it failed and orange while it runs.
- An orange working line says what pi is doing, for example `✶ Running git status… (12s · ↓ 1.2k tokens)`.
- `❯` before the input and past prompts, `●` before replies, and no `Thinking...` placeholders while thinking is hidden.
- Prompt guidelines that steer models to pi's `write` and `edit` tools instead of `cat <<EOF` or `sed -i`, so file changes show as diffs.

`ctrl+o` switches every row back to full detail.

## Notes

- Tuned for dark themes.

## License

MIT
