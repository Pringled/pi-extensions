import assert from "node:assert/strict";
import { test } from "node:test";
import { fauxAssistantMessage, startPi } from "../../../test/harness.mts";

const extensions = ["packages/pi-away/extensions/away.ts"];

test("/recap shows the model's recap on one line, and the next run clears it", async () => {
	const pi = await startPi({ extensions, replies: [fauxAssistantMessage("Fixed `parse()`.\n\nNext: run the tests."), fauxAssistantMessage("ok")] });
	await pi.command("/recap");
	assert.deepEqual(pi.ui.widget("recap"), ["", "※ recap: Fixed parse(). Next: run the tests."]);

	await pi.session.prompt("go on");
	assert.equal(pi.ui.widget("recap"), undefined);
	await pi.dispose();
});

test("/recap says so when the model can't write one", async () => {
	const pi = await startPi({ extensions, replies: [fauxAssistantMessage("", { stopReason: "error", errorMessage: "overloaded" })] });
	await pi.command("/recap");
	assert.equal(pi.ui.widget("recap"), undefined);
	assert.deepEqual(pi.ui.notes, [{ message: "Couldn't write a recap", type: "warning" }]);
	await pi.dispose();
});
