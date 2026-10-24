# pi-extensions

A set of extensions that make [Pi](https://pi.dev) nicer to use. They're minimal by design: most are under 300 lines with no dependencies, and each one can be installed on its own to fit your workflow. All of them are part of my daily setup.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/Pringled/pi-extensions/main/assets/images/pi-extensions-dark.gif">
  <img src="https://raw.githubusercontent.com/Pringled/pi-extensions/main/assets/images/pi-extensions-light.gif" alt="Pi with pi-polish, pi-context-bar and pi-next-prompt">
</picture>

## Look and feel

| Package | What it does | npm |
| --- | --- | --- |
| [`pi-polish`](packages/pi-polish) | Claude Code-style tool rows and diffs. | [![npm](https://img.shields.io/npm/v/pi-polish)](https://www.npmjs.com/package/pi-polish) |
| [`pi-context-bar`](packages/pi-context-bar) | A one-line footer with the model, branch, context bar and cost. | [![npm](https://img.shields.io/npm/v/pi-context-bar)](https://www.npmjs.com/package/pi-context-bar) |

<details>
<summary>Demos</summary>

**pi-polish**

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/Pringled/pi-extensions/main/assets/images/pi-polish-dark.gif">
  <img src="https://raw.githubusercontent.com/Pringled/pi-extensions/main/assets/images/pi-polish-light.gif" alt="pi-polish demo">
</picture>

**pi-context-bar**

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/Pringled/pi-extensions/main/assets/images/pi-context-bar-dark.gif">
  <img src="https://raw.githubusercontent.com/Pringled/pi-extensions/main/assets/images/pi-context-bar-light.gif" alt="pi-context-bar demo">
</picture>

</details>

## Workflow

| Package | What it does | npm |
| --- | --- | --- |
| [`pi-background`](packages/pi-background) | Background jobs and a bash timeout, so Pi never blocks or hangs. | [![npm](https://img.shields.io/npm/v/pi-background)](https://www.npmjs.com/package/pi-background) |
| [`pi-checkpoints`](packages/pi-checkpoints) | Rewind the files Pi edited along with the conversation. | [![npm](https://img.shields.io/npm/v/pi-checkpoints)](https://www.npmjs.com/package/pi-checkpoints) |
| [`pi-browser-review`](packages/pi-browser-review) | Review Pi's changes in a GitHub-style browser view and send your line comments back. | [![npm](https://img.shields.io/npm/v/pi-browser-review)](https://www.npmjs.com/package/pi-browser-review) |
| [`pi-model-pick`](packages/pi-model-pick) | A model picker with favorite and recent models first. | [![npm](https://img.shields.io/npm/v/pi-model-pick)](https://www.npmjs.com/package/pi-model-pick) |

<details>
<summary>Demos</summary>

**pi-background**

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/Pringled/pi-extensions/main/assets/images/pi-background-dark.gif">
  <img src="https://raw.githubusercontent.com/Pringled/pi-extensions/main/assets/images/pi-background-light.gif" alt="pi-background demo">
</picture>

**pi-checkpoints**

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/Pringled/pi-extensions/main/assets/images/pi-checkpoints-dark.gif">
  <img src="https://raw.githubusercontent.com/Pringled/pi-extensions/main/assets/images/pi-checkpoints-light.gif" alt="pi-checkpoints demo">
</picture>

**pi-browser-review**

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/Pringled/pi-extensions/main/assets/images/pi-browser-review-dark.gif">
  <img src="https://raw.githubusercontent.com/Pringled/pi-extensions/main/assets/images/pi-browser-review-light.gif" alt="pi-browser-review demo">
</picture>

**pi-model-pick**

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/Pringled/pi-extensions/main/assets/images/pi-model-pick-dark.gif">
  <img src="https://raw.githubusercontent.com/Pringled/pi-extensions/main/assets/images/pi-model-pick-light.gif" alt="pi-model-pick demo">
</picture>

</details>

## Helpers

| Package | What it does | npm |
| --- | --- | --- |
| [`pi-next-prompt`](packages/pi-next-prompt) | Suggests your next prompt in grey after each reply. | [![npm](https://img.shields.io/npm/v/pi-next-prompt)](https://www.npmjs.com/package/pi-next-prompt) |
| [`pi-away`](packages/pi-away) | A one-line recap of the session when you come back. | [![npm](https://img.shields.io/npm/v/pi-away)](https://www.npmjs.com/package/pi-away) |
| [`pi-heads-up`](packages/pi-heads-up) | Flags the one thing you might have missed after a task. | [![npm](https://img.shields.io/npm/v/pi-heads-up)](https://www.npmjs.com/package/pi-heads-up) |

<details>
<summary>Demos</summary>

**pi-next-prompt**

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/Pringled/pi-extensions/main/assets/images/pi-next-prompt-dark.gif">
  <img src="https://raw.githubusercontent.com/Pringled/pi-extensions/main/assets/images/pi-next-prompt-light.gif" alt="pi-next-prompt demo">
</picture>

**pi-away**

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/Pringled/pi-extensions/main/assets/images/pi-away-dark.gif">
  <img src="https://raw.githubusercontent.com/Pringled/pi-extensions/main/assets/images/pi-away-light.gif" alt="pi-away demo">
</picture>

**pi-heads-up**

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/Pringled/pi-extensions/main/assets/images/pi-heads-up-dark.gif">
  <img src="https://raw.githubusercontent.com/Pringled/pi-extensions/main/assets/images/pi-heads-up-light.gif" alt="pi-heads-up demo">
</picture>

</details>

## Install

```bash
pi install npm:pi-polish
pi install npm:pi-context-bar
pi install npm:pi-background
pi install npm:pi-checkpoints
pi install npm:pi-browser-review
pi install npm:pi-model-pick
pi install npm:pi-next-prompt
pi install npm:pi-away
pi install npm:pi-heads-up
```

## Author

Thomas van Dongen

## License

MIT
