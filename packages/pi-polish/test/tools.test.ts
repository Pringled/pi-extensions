import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fauxAssistantMessage, fauxToolCall, plain, startPi, theme } from "../../../test/harness.mts";

const extensions = ["packages/pi-polish/extensions/tools.ts"];
type Pi = Awaited<ReturnType<typeof startPi>>;

/** How a tool row draws itself, as Pi would ask pi-polish for it. */
function row(pi: Pi, name: string, id: string, args: unknown, expanded = false) {
	const context = { toolCallId: id, args, expanded, invalidate() {}, executionStarted: true, argsComplete: true, isPartial: false, isError: false, cwd: pi.cwd, state: {}, showImages: false, lastComponent: undefined };
	return pi.runner.resolveToolRenderers(name, () => undefined)!.renderCall!(args, theme, context as any);
}
const click = (component: any) => component.handleMouse({ type: "click", button: "left", x: 0, y: 0 });

test("consecutive reads and commands fold into one summary row, which a click or ctrl+o opens", async () => {
	const pi = await startPi({ extensions });
	writeFileSync(join(pi.cwd, "a.txt"), "alpha\n");
	writeFileSync(join(pi.cwd, "b.txt"), "beta\n");
	const calls = [fauxToolCall("read", { path: "a.txt" }, { id: "r1" }), fauxToolCall("read", { path: "b.txt" }, { id: "r2" }), fauxToolCall("bash", { command: "echo hi" }, { id: "b1" })];
	pi.faux.setResponses([fauxAssistantMessage(calls), fauxAssistantMessage("Done.")]);
	await pi.session.prompt("look around");
	const first = (expanded = false) => row(pi, "read", "r1", calls[0].arguments, expanded);

	assert.deepEqual(plain(first().render(80)), ["  Read 2 files, ran 1 shell command"]);
	assert.deepEqual(plain(row(pi, "read", "r2", calls[1].arguments).render(80)), []);
	assert.deepEqual(plain(row(pi, "bash", "b1", calls[2].arguments).render(80)), []);

	const tree = ["● Read 2 files, ran 1 shell command", "  ├ ● Read a.txt", "  │   alpha", "  ├ ● Read b.txt", "  │   beta", "  └ ● $ echo hi", "      hi"];
	click(first());
	assert.deepEqual(plain(first().render(80)), tree);
	click(first());
	assert.deepEqual(plain(first().render(80)), ["  Read 2 files, ran 1 shell command"]);

	// ctrl+o opens every group, and a click still folds this one while it's on
	assert.deepEqual(plain(first(true).render(80)), tree);
	click(first(true));
	assert.deepEqual(plain(first(true).render(80)), ["  Read 2 files, ran 1 shell command"]);
	await pi.dispose();
});

test("an edit shows what changed as a diff under the row", async () => {
	const pi = await startPi({ extensions });
	writeFileSync(join(pi.cwd, "app.py"), "print('hello')\nprint('done')\n");
	const args = { path: "app.py", edits: [{ oldText: "hello", newText: "bye" }] };
	pi.faux.setResponses([fauxAssistantMessage(fauxToolCall("edit", args, { id: "e1" })), fauxAssistantMessage("Edited.")]);
	await pi.session.prompt("edit it");
	const result = pi.session.messages.find((m: any) => m.role === "toolResult");
	const renderers = pi.runner.resolveToolRenderers("edit", () => undefined)!;
	const context = { toolCallId: "e1", args, expanded: false, isError: false, isPartial: false, executionStarted: true, invalidate() {} };

	assert.deepEqual(plain(renderers.renderCall!(args, theme, context as any).render(80)), ["● Update app.py"]);
	const lines = plain(renderers.renderResult!(result as any, { expanded: false, isPartial: false }, theme, context as any).render(80));
	assert.equal(lines[0], "  └ Added 1 line, removed 1 line");
	assert.deepEqual(lines.slice(1).map((line) => line.trim()), ["1 - print('hello')", "1 + print('bye')", "2   print('done')"]);
	await pi.dispose();
});

test("with pi-background, a command that can move to the background says so under its row", async () => {
	const pi = await startPi({
		extensions: [...extensions, "packages/pi-background/extensions/background.ts"],
		settings: { background: { key: "alt+b" } },
		replies: [fauxAssistantMessage(fauxToolCall("bash", { command: "sleep 30" }, { id: "s1" })), fauxAssistantMessage("ok")],
	});
	const prompt = pi.session.prompt("wait");
	await new Promise((r) => setTimeout(r, 3300));
	assert.deepEqual(plain(row(pi, "bash", "s1", { command: "sleep 30" }).render(80)).slice(1), ["  └ $ sleep 30", "    (alt+b to run in background)"]);
	// Only pi-polish shows the hint, not pi-background's jobs line too
	assert.deepEqual(pi.ui.widget("background-jobs"), []);
	assert.equal(pi.ui.input("\x1bb"), true);
	await prompt;
	await pi.dispose();
});
