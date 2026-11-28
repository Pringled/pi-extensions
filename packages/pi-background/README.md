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

- Long commands like downloads, builds, test suites and training runs run in the background, and Pi gets the exit code and the end of the output when they finish.
- Running jobs show above the input, for example `⏵ bg1 python3 train.py · 4m12s · epoch 3/10 loss 0.41`. Click one or run `/bg` to see and scroll its live output (double-tap `x` or run `/bg kill <id>` to stop a running job, `←` to go back to the job list). A job that has been silent for 10 minutes is flagged, so a stuck one stands out.
- Pi can wait for a specific line, such as a dev server's `listening on`, without checking again and again.
- Jobs started together are reported together, so Pi answers once when the last one finishes instead of after each.
- A shell command still running after 2 minutes moves to the background by itself, so it never holds up the turn. `ctrl+b` moves one sooner.
- In `pi -p` and `--mode json`, Pi waits for running jobs and reads their results before it exits. With `PI_BACKGROUND_SETTLE_WAIT=1`, `--mode rpc` waits too, for hosts that treat the first settle as the end of the turn.

Pi decides when a job belongs in the background, and you can also ask, for example "run the tests in the background and tell me when they're done".

## Settings

The running jobs line has three levels. Set one in `~/.pi/agent/settings.json`, for example `"background": { "jobs": "compact" }`.

| `jobs` | What it shows |
| --- | --- |
| `full` (default) | `⏵ bg1 python3 train.py · 4m12s · epoch 3/10 loss 0.41` |
| `compact` | `⏵ bg1 python3 train.py · 4m12s` |
| `off` | Nothing |

In `pi -p` and `--mode json`, Pi waits up to 30 minutes for running jobs. Change it with `"background": { "exitWait": 120 }` (in minutes), or `0` for no limit.

In `--mode rpc` the wait is off by default, because a host that reads events live (Pi Web, an editor) wants the turn to settle and hear about the job later. Set `PI_BACKGROUND_SETTLE_WAIT=1` in the environment of the process that starts `pi --mode rpc` when that host instead ends the turn on the first `agent_settled` and stops forwarding events: the job then finishes, its report is read, and the settle arrives once, after the answer. It uses the same `exitWait` limit. A stop is honored at the next settle point, which for a host that stops the process (as Open WebUI does) is immediate, because Pi aborts the waiting job on shutdown.

The shortcut that moves a running command to the background is `ctrl+b`. Change it with `"background": { "key": "alt+b" }` (for example when tmux uses `ctrl+b`), or `"off"` to disable it.

## Tools

Pi gets three tools for this: `bg_run` starts a job, `bg_status` shows how it's doing and its latest output, and `bg_kill` stops it. Jobs run with the same environment and sandbox as Pi's own shell commands, and stop when you close Pi.

## License

MIT
