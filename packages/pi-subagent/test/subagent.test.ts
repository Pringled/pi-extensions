import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { fauxAssistantMessage, plain, startPi, theme, until } from "../../../test/harness.mts";

const extensions = ["packages/pi-subagent/extensions/subagent.ts"];

// Agents run the Pi that's running, which in tests is this stand-in: it reads a file, then answers with the arguments it got
const fake = join(getAgentDir(), "fake-pi.mjs");
writeFileSync(
	fake,
	`const say = (event) => console.log(JSON.stringify(event));
say({ type: "tool_execution_start", toolName: "read", args: { path: "src/auth.ts" } });
setTimeout(() => say({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: JSON.stringify(process.argv.slice(2)) }] } }), 400);
`,
);
process.argv[1] = fake;
mkdirSync(join(getAgentDir(), "agents"), { recursive: true });
writeFileSync(join(getAgentDir(), "agents", "explore.md"), "---\ncontext: fork\n---\nTry the other approach.\n");
writeFileSync(join(getAgentDir(), "agents", "review.md"), "---\ndescription: Reviews the branch\nmodel: openai/gpt-5\n---\nReview $ARGUMENTS for bugs.\n");

for (const [line, label, prompt, model] of [
	["/agent review the auth code", "agent review the auth code", "Review the auth code for bugs.", "openai/gpt-5"],
	["/agent  fix   the tests", 'agent "fix the tests"', "fix   the tests", "faux/faux-1"],
]) {
	test(`${line} runs in the background and its report comes back`, async () => {
		const pi = await startPi({ extensions });
		await pi.command(line);
		assert.match(pi.ui.widget("subagents")![0], new RegExp(`^⏵ ${label} · 0:0\\d$`));
		const message: any = await until(() => pi.session.messages.find((m: any) => m.customType === "subagent"));
		const args = JSON.parse(message.content.split("\n\n")[1]);
		assert.equal(args[args.indexOf("--mode") + 1], "json");
		assert.equal(args.at(-1), prompt);
		assert.equal(args[args.indexOf("--model") + 1], model);
		const id = args[args.indexOf("--session-id") + 1];
		assert.match(message.content, new RegExp(`^${label} finished:[\\s\\S]*pi --session ${id}\\)$`));
		const shown = plain(pi.runner.getMessageRenderer("subagent")!(message, { expanded: false } as any, theme)!.render(100));
		assert.match(shown[0], new RegExp(`^● ${label} · done in 0:0\\d$`));
		assert.equal(shown.at(-1), `    pi --session ${id}`);
		assert.deepEqual(pi.ui.widget("subagents"), []);
		await pi.dispose();
	});
}

test("an agent with context: fork starts from a copy of this conversation, which has to be saved", async () => {
	const pi = await startPi({ extensions });
	await pi.command("/agent explore");
	assert.deepEqual(pi.ui.notes.at(-1), { message: "agent explore starts from this conversation, which isn't saved", type: "warning" });
	(pi.session.sessionManager as any).getSessionFile = () => "/saved/session.jsonl";
	await pi.command("/agent explore");
	const message: any = await until(() => pi.session.messages.find((m: any) => m.customType === "subagent"));
	const args = JSON.parse(message.details.text);
	assert.equal(args[args.indexOf("--fork") + 1], "/saved/session.jsonl");
	await pi.dispose();
});

test("clicking an agent's line shows what it's doing, and clicking its title closes it again", async () => {
	const pi = await startPi({ extensions });
	await pi.command("/agent review");
	const click = (component: any, y: number) => component.handleMouse({ type: "click", button: "left", x: 0, y });
	await until(() => pi.ui.widget("subagents")!.length);
	click(pi.ui.widgets.get("subagents"), 0);
	const view = await until(() => pi.ui.open && plain(pi.ui.open.component.render(60)));
	assert.match(view[1], /^ ● agent review +running · 0:0\d$/);
	await until(() => plain(pi.ui.open!.component.render(60)).includes("   read src/auth.ts"));
	click(pi.ui.open!.component, 1);
	assert.equal(pi.ui.open, undefined);
	await until(() => pi.session.messages.find((m: any) => m.customType === "subagent"));
	await pi.dispose();
});

test("Pi only gets the agent tool in runs a command or prompt template started", async () => {
	const offered: boolean[] = [];
	const reply = () => {
		offered.push(pi.session.getActiveToolNames().includes("agent"));
		return fauxAssistantMessage("ok");
	};
	const pi = await startPi({ extensions, replies: [reply, reply, reply, reply] });
	await pi.session.prompt("hello");
	await pi.session.prompt("/review the branch");
	await pi.session.prompt("hello again");
	await pi.session.prompt("run the workflow", { source: "extension" });
	assert.deepEqual(offered, [false, true, false, true]);
	await pi.dispose();
});
