# pi-heads-up

After [Pi](https://pi.dev) finishes a task, a quick second look at the conversation flags the one thing you might have missed: a tradeoff Pi made without saying so, something it didn't check, or a change beyond what you asked for.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/Pringled/pi-extensions/main/assets/images/pi-heads-up-dark.gif">
  <img src="https://raw.githubusercontent.com/Pringled/pi-extensions/main/assets/images/pi-heads-up-light.gif" alt="pi-heads-up demo">
</picture>

```bash
pi install npm:pi-heads-up
```

## Usage

When there's something worth knowing, a note shows above the input:

```
✦ heads-up: The rename removed spread() outright with no alias, so any code outside this folder that imports spread will break.
```

Most of the time there's nothing to flag and no note appears. Quick questions don't get a second look, only tasks where Pi used a few tools. The note goes away when you send your next message.

## How it works

The second look comes from the same model, asked with the conversation exactly as Pi sends it and at the same thinking level, so it reuses Pi's prompt cache. It's told to leave out anything Pi's reply already says and anything minor.

## License

MIT
