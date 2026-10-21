# pi-extensions

My extensions for the [pi](https://pi.dev) coding agent. Most of these are inspired by Claude Code: tidier tool output with real diffs, background jobs that don't block the agent, a better model picker, and a compact status line.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/Pringled/pi-extensions/main/assets/images/pi-polish-dark.gif">
  <img src="https://raw.githubusercontent.com/Pringled/pi-extensions/main/assets/images/pi-polish-light.gif" alt="pi with pi-polish">
</picture>

## Packages

| Package                                     | What it does                                                                          | npm                                                 |
| ------------------------------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------- |
| [`pi-polish`](packages/pi-polish)           | Claude Code-style tool rows and diffs.                                                | [npm](https://www.npmjs.com/package/pi-polish)      |
| [`pi-background`](packages/pi-background)   | Background jobs that wake pi when they finish, and a bash timeout so pi doesn't hang. | [npm](https://www.npmjs.com/package/pi-background)  |
| [`pi-model-pick`](packages/pi-model-pick)   | A model picker with favorite and recent models first.                                 | [npm](https://www.npmjs.com/package/pi-model-pick)  |
| [`pi-context-bar`](packages/pi-context-bar) | A one-line footer with the model, branch, context bar and cost.                       | [npm](https://www.npmjs.com/package/pi-context-bar) |

```bash
pi install npm:pi-polish
pi install npm:pi-background
pi install npm:pi-model-pick
pi install npm:pi-context-bar
```

## Author

Thomas van Dongen

## License

MIT
