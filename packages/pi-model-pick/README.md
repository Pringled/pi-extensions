# pi-model-pick

A model picker for [Pi](https://pi.dev) with your favorite and recently used models at the top. Pi's own `/model` shows every model from every provider in one long list; this one puts the ones you use first.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/Pringled/pi-extensions/main/assets/images/pi-model-pick-dark.gif">
  <img src="https://raw.githubusercontent.com/Pringled/pi-extensions/main/assets/images/pi-model-pick-light.gif" alt="pi-model-pick demo">
</picture>

```bash
pi install npm:pi-model-pick
```

## Usage

- `/pick` or `ctrl+shift+m` opens the picker: favorites first, then the last 8 models you used, then all models. Type to filter.
- `/fav` stars or unstars the current model.

Favorites and recents are kept in `~/.pi/agent/model-picker-state.json`. Pi's own `/model` picker is unchanged.

## License

MIT
