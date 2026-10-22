# pi-checkpoints

Lets you rewind the files [pi](https://pi.dev) edited along with the conversation. pi's `/tree` and `/fork` already take you back to any earlier message, but your files stay as they are. With this installed, they offer to put the files back too.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/Pringled/pi-extensions/main/assets/images/pi-checkpoints-dark.gif">
  <img src="https://raw.githubusercontent.com/Pringled/pi-extensions/main/assets/images/pi-checkpoints-light.gif" alt="pi-checkpoints demo">
</picture>

```bash
pi install npm:pi-checkpoints
```

## Usage

- `/tree` and pick an earlier message: pi asks whether to restore the files it changed since then. Pick a later message again, even on a branch you left, and they come back, so this works as both undo and redo.
- `/fork` from an earlier message does the same before it starts the new session.

The prompt lists the files it will restore, so you can say no and keep what you have.

## How it works

Before pi first edits or writes a file in a run, the file's content is saved, and again once the run is done. Each saved version is kept once under `~/.pi/agent/checkpoints`, and the session keeps track of which files each run changed. Undoing a new file also removes the folders pi made for it, as long as they're empty.

Only changes made with pi's `edit` and `write` tools are tracked, like Claude Code's checkpoints. Changes made by shell commands aren't, and if you or a shell command changed one of pi's files since, restoring overwrites that change.

## License

MIT
