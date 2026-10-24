# pi-browser-review

Review what [Pi](https://pi.dev) changed in a GitHub-style view in your browser, leave comments on lines, and send them all back to Pi in one go. The review view is [difit](https://github.com/yoshiko-pg/difit).

```bash
npm install -g difit
pi install npm:pi-browser-review
```

## Usage

Run `/review`. Your browser opens with everything on the current branch since it left `main`, including uncommitted changes and new files. Click a line, or drag over several, to comment. When you're done, run `/review` again in Pi and your comments go to Pi as one message:

```
Here are my review comments on the changes against main:

stats.py:L16
Use statistics.median instead of writing our own

extra.py:L1-L2
We don't need mode(), remove this file
```

If Pi is busy, the message waits until it's done. If you didn't leave any comments, nothing is sent. Closing or reloading the tab doesn't end the review, and the view updates by itself when files change, so you can keep it open while Pi works.

- `/review develop` compares with another branch instead of the default one.
- On `main` itself, `/review` shows your uncommitted changes.
- If the browser didn't open, the address is shown above Pi's input.

## License

MIT
