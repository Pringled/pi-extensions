import assert from "node:assert/strict";
import { test } from "node:test";
import { fauxAssistantMessage, fauxToolCall, startPi, until } from "../../../test/harness.mts";

const extensions = ["packages/pi-heads-up/extensions/heads-up.ts"];
const threeCalls = fauxAssistantMessage([1, 2, 3].map((n) => fauxToolCall("bash", { command: `echo ${n}` })));

test("after real work, the model's heads-up shows under the reply", async () => {
	const pi = await startPi({ extensions, replies: [threeCalls, fauxAssistantMessage("All done."), fauxAssistantMessage("The tests weren't run.")] });
	await pi.session.prompt("do it");
	assert.deepEqual(await until(() => pi.ui.widget("heads-up")), ["", "✦ heads-up: The tests weren't run."]);
	await pi.dispose();
});

test("no heads-up when the model has nothing to flag", async () => {
	const pi = await startPi({ extensions, replies: [threeCalls, fauxAssistantMessage("All done."), fauxAssistantMessage("NONE")] });
	await pi.session.prompt("do it");
	await until(() => pi.faux.getPendingResponseCount() === 0);
	await new Promise((r) => setTimeout(r, 50));
	assert.equal(pi.ui.widget("heads-up"), undefined);
	await pi.dispose();
});

test("a quick question doesn't get a second look", async () => {
	const pi = await startPi({ extensions, replies: [fauxAssistantMessage("Yes."), fauxAssistantMessage("unused")] });
	await pi.session.prompt("quick question");
	await new Promise((r) => setTimeout(r, 50));
	assert.equal(pi.faux.getPendingResponseCount(), 1);
	await pi.dispose();
});
