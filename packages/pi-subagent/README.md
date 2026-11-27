# pi-subagent

Your own subagents for [Pi](https://pi.dev), run in the background with `/agent`. Pi never starts one on its own.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/Pringled/pi-extensions/main/assets/images/pi-subagent-dark.gif">
  <img src="https://raw.githubusercontent.com/Pringled/pi-extensions/main/assets/images/pi-subagent-light.gif" alt="pi-subagent demo">
</picture>

```bash
pi install npm:pi-subagent
```

## Usage

An agent is a markdown file in `~/.pi/agent/agents/`. The file name is the agent's name, the body is its prompt, and the frontmatter can set a description and model:

```markdown
---
description: Review this branch before merging
model: openai/gpt-5
---
Review this branch against main for bugs. $ARGUMENTS
```

- `/agent review` runs it in the background while you keep working. `/agent review focus on the auth code` puts the rest where the prompt says `$ARGUMENTS`, or after the prompt when it doesn't.
- `/agent <prompt>` runs any other prompt the same way, with the model you're on.
- `/agent` on its own lists your agents.

Each running agent gets a line above the input; click it to see what the agent is doing, and click its title or press esc to close that again. Its report lands in the chat when it's done. Every agent's session is saved, so you can open it with `pi --session <id>` (the report says which) and carry on where it stopped.

Prompt templates can hand work to agents too. In a run started by a command or prompt template, Pi gets an `agent` tool, so a template can say "use the agent tool with openai/gpt-5 to look for bugs, and another one with anthropic/claude-opus for code that could be simpler, then combine their reports". It waits for their reports instead of running them in the background, so a template can stop in between to ask you something.

## How it works

Each agent is a separate non-interactive Pi in the same folder (`pi --mode json`, so you can follow what it does), with your settings, extensions and skills but none of this conversation, so its prompt has to say everything it needs. In a run you start by typing a normal message the `agent` tool isn't there, so Pi can't reach for it.

## License

MIT
