# pi-extensions

My extensions for the [pi](https://pi.dev) coding agent. Each package installs on its own.

| Package | What it does |
| --- | --- |
| [`pi-polish`](packages/pi-polish) | Claude Code-style tool rows and diffs. |
| [`pi-background`](packages/pi-background) | Background jobs that wake pi when they finish, and a bash timeout so pi doesn't hang. |
| [`pi-model-pick`](packages/pi-model-pick) | A model picker with favorite and recent models first. |

```bash
pi install npm:pi-polish
pi install npm:pi-background
pi install npm:pi-model-pick
```

## Development

The extensions are TypeScript files in each package's `extensions/` folder, loaded by pi without a build step. To try a local change:

```bash
(cd packages/pi-polish && npm install --omit=peer)
pi install ./packages/pi-polish
```

## License

MIT
