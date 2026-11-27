import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { fauxAssistantMessage, startPi, until } from "../../../test/harness.mts";

const extensions = ["packages/pi-subagent/extensions/subagent.ts"];

// Agents run the Pi that's running, which in tests is this stand-in: it answers with the arguments it got
const fake = join(getAgentDir(), "fake-pi.mjs");
writeFileSync(fake, "setTimeout(() => console.log(JSON.stringify(process.argv.slice(2))), 300);\n");
process.argv[1] = fake;
mkdirSync(join(getAgentDir(), "agents"), { recursive: true });
writeFileSync(join(getAgentDir(), "agents", "review.md"), "---\ndescription: Reviews the branch\nmodel: openai/gpt-5\n---\nReview $ARGUMENTS for bugs.\n");

for (const [line, label, prompt, model] of [
	["/agent review the auth code", "review the auth code", "Review the auth code for bugs.", "openai/gpt-5"],
	["/agent  fix   the tests", "fix the tests", "fix   the tests", "faux/faux-1"],
]) {
	test(`${line} runs in the background and its report comes back`, async () => {
		const pi = await startPi({ extensions });
		await pi.command(line);
		assert.match(pi.ui.widget("subagents")![0], new RegExp(`^⏵ ${label} · 0:0\\d$`));
		const message: any = await until(() => pi.session.messages.find((m: any) => m.customType === "subagent"));
		const args = JSON.parse(message.content.split("\n\n")[1]);
		assert.equal(args.at(-1), prompt);
		assert.equal(args[args.indexOf("--model") + 1], model);
		assert.match(message.content, new RegExp(`^Agent ${label} finished:[\\s\\S]*pi --session ${args[args.indexOf("--session-id") + 1]}\\)$`));
		assert.deepEqual(pi.ui.widget("subagents"), []);
		await pi.dispose();
	});
}

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
