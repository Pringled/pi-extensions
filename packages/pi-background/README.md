# pi-background

Background jobs for [pi](https://pi.dev) that wake the agent when they finish or print what it is waiting for, plus a bash timeout so pi doesn't hang on a command.

```bash
pi install npm:pi-background
```

## Tools

- **`bg_run`** starts a shell command in the background and returns a job id. When the job exits, pi gets the exit code and the last log lines. With `wake_on` (a regex), pi is also woken while the job runs whenever an output line matches, such as `listening on` for a dev server or `epoch \d+` for a training run.
- **`bg_status`** lists jobs, or shows one job's state and log tail.
- **`bg_kill`** stops a job and its child processes.

Jobs run through pi's own shell, with the same environment and sandbox as `bash`, and stop when the session ends.

## Bash timeout

Foreground `bash` commands time out after 2 minutes by default, raisable to 10 minutes per command. A command that starts a background job with `&` is never timed out, because a timeout kills the command's whole process group, including that job.

The extension also tells the model to use `bg_run` for downloads, heavy installs, builds, full test suites, training runs and anything that waits or polls, and to keep quick commands in `bash`.

## License

MIT
