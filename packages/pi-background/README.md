# pi-background

Lets [Pi](https://pi.dev) run long commands in the background instead of waiting on them. Pi starts the job, carries on or hands back to you, and gets a message when the job finishes or prints something it's waiting for.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/Pringled/pi-extensions/main/assets/images/pi-background-dark.gif">
  <img src="https://raw.githubusercontent.com/Pringled/pi-extensions/main/assets/images/pi-background-light.gif" alt="pi-background demo">
</picture>

```bash
pi install npm:pi-background
```

## Features

- Long commands like downloads, builds, test suites and training runs go to the background, and Pi hears back with the exit code and the end of the output when they finish.
- While a job runs, a line above the input shows it with its elapsed time and latest output, such as `⏵ bg1 python3 train.py · 4m12s · epoch 3/10 loss 0.41`.
- Pi can wait for a specific line, such as a dev server's `listening on` or a training run's `epoch 3`, without checking again and again.
- Regular commands time out after 2 minutes, unless Pi asks for longer (up to 10), so Pi never hangs on a stuck command. Commands that start their own background process with `&` are left alone.

You don't need to do anything differently: Pi decides when a job belongs in the background. You can also ask for it, for example "run the tests in the background and tell me when they're done".

## Settings

The running jobs line has three levels. Set one in `~/.pi/agent/settings.json`, for example `"background": { "jobs": "compact" }`.

| `jobs` | What it shows |
| --- | --- |
| `full` (default) | `⏵ bg1 python3 train.py · 4m12s · epoch 3/10 loss 0.41` |
| `compact` | `⏵ bg1 python3 train.py · 4m12s` |
| `off` | Nothing |

## Tools

Pi gets three tools for this: `bg_run` starts a job, `bg_status` shows how it's doing and its latest output, and `bg_kill` stops it. Jobs run with the same environment and sandbox as Pi's own shell commands, and stop when you close Pi.

## License

MIT
