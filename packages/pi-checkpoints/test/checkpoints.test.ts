import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fauxAssistantMessage, fauxToolCall, startPi } from "../../../test/harness.mts";

const extensions = ["packages/pi-checkpoints/extensions/checkpoints.ts"];

/** A session where Pi first writes new/dir/notes.txt, then edits it in a second run. */
async function twoRuns() {
	const pi = await startPi({
		extensions,
		replies: [
			fauxAssistantMessage(fauxToolCall("write", { path: "new/dir/notes.txt", content: "hello\n" })),
			fauxAssistantMessage("Written."),
			fauxAssistantMessage(fauxToolCall("edit", { path: "new/dir/notes.txt", edits: [{ oldText: "hello", newText: "bye" }] })),
			fauxAssistantMessage("Edited."),
		],
	});
	await pi.session.prompt("write it");
	await pi.session.prompt("edit it");
	const file = join(pi.cwd, "new/dir/notes.txt");
	assert.equal(readFileSync(file, "utf8"), "bye\n");
	const entries = pi.session.sessionManager.getEntries() as any[];
	const message = (role: string, n: number) => entries.filter((e) => e.type === "message" && e.message.role === role)[n];
	return { pi, file, firstPrompt: message("user", 0), afterFirstRun: message("assistant", 1) };
}

test("going back in the tree puts files back as they were there, and removes the folders Pi created", async () => {
	const { pi, file, firstPrompt, afterFirstRun } = await twoRuns();

	await pi.session.navigateTree(afterFirstRun.id);
	assert.equal(pi.ui.dialogs[0].title, "Restore 1 file?");
	assert.equal(readFileSync(file, "utf8"), "hello\n");

	await pi.session.navigateTree(firstPrompt.id);
	assert.equal(existsSync(file), false);
	assert.equal(existsSync(join(pi.cwd, "new")), false);
	assert.deepEqual(pi.ui.notes.map((n) => n.message), ["Restored 1 file", "Restored 1 file"]);
	await pi.dispose();
});

test("a change made outside Pi is called out, and declining leaves the file alone", async () => {
	const { pi, file, afterFirstRun } = await twoRuns();
	writeFileSync(file, "mine\n");
	pi.ui.answers.push(false);

	await pi.session.navigateTree(afterFirstRun.id);
	assert.match(String(pi.ui.dialogs[0].body), /notes\.txt {2}\(changed since Pi's last edit/);
	assert.equal(readFileSync(file, "utf8"), "mine\n");
	await pi.dispose();
});
