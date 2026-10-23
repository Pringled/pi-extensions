# pi-polish

Makes [Pi](https://pi.dev)'s output look like Claude Code's: tool calls fold into short summary lines, and edits show as colored diffs.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/Pringled/pi-extensions/main/assets/images/pi-polish-dark.gif">
  <img src="https://raw.githubusercontent.com/Pringled/pi-extensions/main/assets/images/pi-polish-light.gif" alt="pi-polish demo">
</picture>

```bash
pi install npm:pi-polish
```

## Features

- Shell commands, file reads and searches in a row fold into one line that updates while they run (`Running 2 shell commands… · 5s`) and then sums them up (`Ran 3 shell commands, read 2 files`). `ctrl+o` shows the full output.
- Edits and new files show as diffs with syntax highlighting and the changed words marked, in colors that follow your Pi theme, dark or light.
- A dot on each tool row shows its status: orange while running, green when done, red if it failed.
- An orange status line shows what Pi is doing, how long it has been at it and how many tokens it has written.
- `❯` marks your messages and `●` marks Pi's replies.
- A short instruction to the model to change files with Pi's edit and write tools instead of shell commands like `sed -i`, so you see the changes as diffs.

## Compatibility

pi-polish only changes how Pi's built-in tools are drawn; the tools themselves run exactly as before. The chat styling (the markers and the status line) reaches into Pi's internal UI, so a new Pi release can break that part of the look until pi-polish is updated. Your sessions are never affected. Tested with Pi 1.3.

## License

MIT
