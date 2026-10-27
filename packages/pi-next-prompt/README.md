# pi-next-prompt

Suggests what you'll probably ask [Pi](https://pi.dev) next. When Pi finishes a reply, a suggestion shows up in grey in the empty input, such as "Go ahead and fix it, then run the tests."

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/Pringled/pi-extensions/main/assets/images/pi-next-prompt-dark.gif">
  <img src="https://raw.githubusercontent.com/Pringled/pi-extensions/main/assets/images/pi-next-prompt-light.gif" alt="pi-next-prompt demo">
</picture>

```bash
pi install npm:pi-next-prompt
```

## Usage

- `Tab` or `→` puts the suggestion in the input, so you can send it with `Enter` or edit it first.
- Typing hides it, and it comes back if you delete what you typed. `esc` dismisses it until the next reply.

There's no suggestion when Pi doesn't see an obvious next step, after an error, or while you have messages queued.

## How it works

After each reply, the extension asks the same model for one short guess at your next message. The request starts with exactly what Pi just sent, at the same thinking level, so it reuses Pi's prompt cache.

## License

MIT
