import assert from "node:assert/strict";
import { test } from "node:test";
import { AssistantMessageComponent, UserMessageComponent } from "@earendil-works/pi-coding-agent";
import { fauxAssistantMessage, plain, startPi } from "../../../test/harness.mts";

test("past prompts and replies get their ❯ and ● markers", async () => {
	const pi = await startPi({ extensions: ["packages/pi-polish/extensions/chrome.ts"] });
	assert.deepEqual(plain(new UserMessageComponent("fix the bug").render(40)), ["❯ fix the bug"]);
	const reply = new AssistantMessageComponent(fauxAssistantMessage("Fixed it.") as any);
	assert.ok(plain(reply.render(40)).includes("● Fixed it."));
	await pi.dispose();
});

test("after a run, a line says how long it took, until the next run starts", async () => {
	const pi = await startPi({ extensions: ["packages/pi-polish/extensions/chrome.ts"], replies: [fauxAssistantMessage("hi"), fauxAssistantMessage("again")] });
	await pi.session.prompt("hello");
	assert.equal(pi.ui.working, undefined);
	assert.match(pi.ui.widget("pi-polish-turn")![0], /^✻ Worked for \ds · done \d{1,2}:\d{2}/);
	await pi.session.prompt("again");
	assert.equal(pi.ui.widget("pi-polish-turn")!.length, 1);
	await pi.dispose();
});
