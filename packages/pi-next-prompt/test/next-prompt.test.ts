import assert from "node:assert/strict";
import { test } from "node:test";
import { fauxAssistantMessage, plain, startPi, until } from "../../../test/harness.mts";

/** Pi's input box, reduced to what next-prompt relies on: its text, and a first content line with the cursor (_) and then spaces. */
const editor = () => {
	let text = "";
	return {
		getText: () => text,
		setText: (value: string) => void (text = value),
		handleInput: (data: string) => void (data === "\x7f" ? (text = text.slice(0, -1)) : /^[ -~]$/.test(data) ? (text += data) : undefined),
		render: (width: number) => ["─".repeat(width), `> ${text}_`.padEnd(width), "─".repeat(width)],
		invalidate() {},
	};
};

async function suggest(suggestion: string) {
	const pi = await startPi({ extensions: ["packages/pi-next-prompt/extensions/next-prompt.ts"], editor, replies: [fauxAssistantMessage("Shall I add tests?"), fauxAssistantMessage(suggestion)] });
	const input = pi.ui.editor(pi.ui.tui, pi.ui.theme, undefined);
	await pi.session.prompt("refactor it");
	await until(() => pi.faux.getPendingResponseCount() === 0);
	await new Promise((r) => setTimeout(r, 20));
	return { pi, input, line: () => plain(input.render(40))[1] };
}

test("the suggested next prompt shows in the empty input, hides while typing and tab takes it", async () => {
	const { pi, input, line } = await suggest('"yes, add tests"');
	assert.equal(line(), "> _yes, add tests");

	input.handleInput("n");
	assert.equal(line(), "> n_");
	input.handleInput("\x7f");
	assert.equal(line(), "> _yes, add tests");

	input.handleInput("\t");
	assert.equal(input.getText(), "yes, add tests");
	await pi.dispose();
});

test("esc dismisses the suggestion", async () => {
	const { pi, input, line } = await suggest("yes");
	input.handleInput("\x1b");
	assert.equal(line(), "> _");
	input.handleInput("\t");
	assert.equal(input.getText(), "");
	await pi.dispose();
});

test("a reply that isn't a short one-line prompt isn't suggested", async () => {
	for (const reply of ["", "first line\nsecond line", "x".repeat(101)]) {
		const { pi, line } = await suggest(reply);
		assert.equal(line(), "> _");
		await pi.dispose();
	}
});
