# pi-browser-review

Review what [Pi](https://pi.dev) changed in a GitHub-style view in your browser, leave comments on lines, and send them all back to Pi in one go. The review view is [difit](https://github.com/yoshiko-pg/difit).

```bash
npm install -g difit
pi install npm:pi-browser-review
```

## Usage

Run `/review`. Your browser opens with everything on the current branch since it left `main`, including uncommitted changes and new files. Click a line, or drag over several, to comment. When you close the tab, your comments go to Pi as one message:

```
Here are my review comments on the diff:

stats.py:L16
Use statistics.median instead of writing our own

extra.py:L1-L2
We don't need mode(), remove this file
```

If Pi is busy, the message waits until it's done. If you close the tab without commenting, nothing is sent.

- `/review develop` compares with another branch instead of the default one.
- On `main` itself, `/review` shows your uncommitted changes.
- If the browser didn't open or closing the tab wasn't noticed, run `/review` again to finish the review and send your comments.

New files are included with `git add --intent-to-add`, so they show up as added in `git status` until you commit or reset them.

## License

MIT
