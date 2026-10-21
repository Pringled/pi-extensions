# pi-model-pick

A model picker for [pi](https://pi.dev) with your favorite and recently used models at the top.

```bash
pi install npm:pi-model-pick
```

## Usage

- `/pick` or `ctrl+shift+m` opens the picker: favorites first, then the last 8 models you used, then all models. Type to filter.
- `/fav` stars or unstars the current model.

Favorites and recents are kept in `~/.pi/agent/model-picker-state.json`. pi's own `/model` picker is unchanged.

## License

MIT
