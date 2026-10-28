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
- While a job runs, a line above the input shows it with its elapsed time and latest output, such as `⏵ bg1 python3 train.py · 4m12s · epoch 3/10 loss 0.41`. A job that has printed nothing for 10 minutes shows `no output for 12m30s` instead, so a stuck one stands out.
- `/bg` shows a job's last 20 lines of output, updating while it runs (`/bg bg2` for a specific job). Press esc to close it. Its list shows running jobs first, then the 10 latest finished ones.
- Pi can wait for a specific line, such as a dev server's `listening on` or a training run's `epoch 3`, without checking again and again.
- Jobs started together are reported together: when Pi starts several jobs at once, such as benchmarks to compare, it's woken once when the last one finishes instead of after each. You can keep chatting meanwhile, and a job that runs much longer doesn't hold the others back for more than 2 minutes.
- A regular shell command still running after 2 minutes moves to the background on its own, so a slow command Pi didn't expect never holds up the turn. It shows in the jobs line, and Pi hears back when it ends. Press `ctrl+b` to move a running command to the background sooner. If another extension already replaces Pi's bash, such as a sandbox, pi-background leaves it alone.

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
