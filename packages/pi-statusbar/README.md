# pi-statusbar

A one-line footer for [pi](https://pi.dev), styled after [ccstatusline](https://github.com/sirmalloc/ccstatusline): the model, git branch, a context bar and the session cost.

```bash
pi install npm:pi-statusbar
```

## What it shows

- The current model, as `provider/model`, and its thinking level.
- The git branch, or `no git` outside a repository.
- A context bar with used and total tokens. It turns yellow at 50% and red at 80%.
- The total cost of the session so far.

It replaces pi's default footer.

## License

MIT
