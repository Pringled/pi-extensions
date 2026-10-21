# pi-statusbar

A one-line footer for [pi](https://pi.dev), styled after [ccstatusline](https://github.com/sirmalloc/ccstatusline): the model, git branch, a context bar and the session cost.

```bash
pi install npm:pi-statusbar
```

## What it shows

- `provider/model` of the current model.
- The git branch, or `no git` outside a repository.
- A context bar with used and total tokens. It turns yellow at 50% and red at 80%.
- The total cost of the session so far.

It replaces pi's default footer, which also shows the working folder and token and cache counts.

## License

MIT
