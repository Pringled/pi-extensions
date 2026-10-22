# pi-away

A one-line recap of where things stand when you come back to [pi](https://pi.dev), like Claude Code's session recap. Start a long task, walk away, and find this above the input when you're back:

```
※ recap: Fixed the off-by-one bug in stats.py's mean() and added median() with tests; all 4 tests pass. Still to decide: how empty lists should be handled.
```

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/Pringled/pi-extensions/main/assets/images/pi-away-dark.gif">
  <img src="https://raw.githubusercontent.com/Pringled/pi-extensions/main/assets/images/pi-away-light.gif" alt="pi-away demo">
</picture>

```bash
pi install npm:pi-away
```

## Usage

- Three minutes after pi finishes, the recap is written in the background, so it's ready whenever you come back. It goes away when you send your next message.
- `/recap` writes one right away, for example in a session you just resumed.

Short sessions, under three messages, don't get an automatic recap.

## How it works

The recap comes from the same model, asked with the conversation exactly as pi sends it and at the same thinking level, so it reuses pi's prompt cache. The automatic recap is written three minutes after pi finishes because the cache lasts about five.

## License

MIT
