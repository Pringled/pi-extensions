# pi-context-bar

A one-line footer for [Pi](https://pi.dev), styled after [ccstatusline](https://github.com/sirmalloc/ccstatusline): the model, git branch, a context bar and the session cost.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/Pringled/pi-extensions/main/assets/images/pi-context-bar-dark.gif">
  <img src="https://raw.githubusercontent.com/Pringled/pi-extensions/main/assets/images/pi-context-bar-light.gif" alt="pi-context-bar">
</picture>

```bash
pi install npm:pi-context-bar
```

## What it shows

- The current model, as `provider/model`, and its thinking level.
- The git branch, or `no git` outside a repository.
- A context bar with used and total tokens. It turns yellow at 50% and red at 80%.
- The total cost of the session so far.

It replaces Pi's default footer.

## License

MIT
