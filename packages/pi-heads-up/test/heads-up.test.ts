import assert from "node:assert/strict";
import { test } from "node:test";
import { fauxAssistantMessage, fauxToolCall, startPi, until } from "../../../test/harness.mts";

const extensions = ["packages/pi-heads-up/extensions/heads-up.ts"];
const threeCalls = fauxAssistantMessage([1, 2, 3].map((n) => fauxToolCall("bash", { command: `echo ${n}` })));

for (const [reply, shown] of [["The tests weren't run.", ["", "✦ heads-up: The tests weren't run."]], ["NONE", undefined]] as const) {
	test(`after real work, a heads-up reply of "${reply}" ${shown ? "shows under the reply" : "shows nothing"}`, async () => {
		const pi = await startPi({ extensions, replies: [threeCalls, fauxAssistantMessage("All done."), fauxAssistantMessage(reply)] });
		await pi.session.prompt("do it");
		await until(() => pi.faux.getPendingResponseCount() === 0);
		if (shown) assert.deepEqual(await until(() => pi.ui.widget("heads-up")), shown);
		else {
			await new Promise((r) => setTimeout(r, 50));
			assert.equal(pi.ui.widget("heads-up"), undefined);
		}
		await pi.dispose();
	});
}

test("a quick question doesn't get a second look", async () => {
	const pi = await startPi({ extensions, replies: [fauxAssistantMessage("Yes."), fauxAssistantMessage("unused")] });
	await pi.session.prompt("quick question");
	await new Promise((r) => setTimeout(r, 50));
	assert.equal(pi.faux.getPendingResponseCount(), 1);
	await pi.dispose();
});
