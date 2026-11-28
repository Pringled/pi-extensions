import assert from "node:assert/strict";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fauxAssistantMessage, fauxToolCall, plain, type PiOptions, startPi, until } from "../../../test/harness.mts";

const extensions = ["packages/pi-background/extensions/background.ts"];
const text = (message: any) => (typeof message.content === "string" ? message.content : message.content.map((c: any) => c.text ?? "").join(""));
const last = (pi: { session: any }, role: string) => pi.session.messages.filter((m: any) => m.role === role).at(-1);

/** A session whose model starts the command with bg_run and then answers each message with the given replies. */
// Relative paths and a shebang, so the same command runs in Git Bash on Windows
async function bgRun(command: string, replies: string[], options: Partial<PiOptions> = {}) {
	const pi = await startPi({ extensions, ...options });
	mkdirSync(join(pi.cwd, "scripts"));
	writeFileSync(join(pi.cwd, "scripts/job.sh"), "#!/bin/sh\necho step 1\nsleep 1\necho finished\n");
	chmodSync(join(pi.cwd, "scripts/job.sh"), 0o755);
	pi.faux.setResponses([fauxAssistantMessage(fauxToolCall("bg_run", { command })), ...replies.map((reply) => fauxAssistantMessage(reply))]);
	return pi;
}

test("a bg_run job shows in the jobs line while it runs and wakes Pi with its result when it exits", async () => {
	const pi = await bgRun("cd . && PYTHONPATH=/some/src ./scripts/job.sh", ["Started it.", "It finished."]);
	await pi.session.prompt("run the job");
	assert.match((await until(() => pi.ui.widget("background-jobs")?.find((line) => line.includes("step 1"))))!, /^⏵ bg1 job\.sh · \ds · step 1$/);

	await until(() => text(last(pi, "assistant")) === "It finished.", 10_000);
	const report = pi.session.messages.find((m: any) => m.customType === "background-job");
	assert.match(text(report), /^Background job finished: bg1 \[exit 0, \ds\][^]*Last lines:\nstep 1\nfinished$/);
	assert.deepEqual(pi.ui.widget("background-jobs"), []);
	await pi.dispose();
});

test("clicking a job in the jobs line opens its output, and clicking the title closes it", async () => {
	const pi = await bgRun("./scripts/job.sh", ["Started it.", "It finished."]);
	await pi.session.prompt("run the job");
	await until(() => pi.ui.widget("background-jobs")?.some((line) => line.includes("step 1")));

	pi.ui.widgets.get("background-jobs").handleMouse({ type: "click", button: "left", x: 2, y: 0 });
	const viewer = await until(() => pi.ui.open?.component);
	const lines = plain(viewer.render(60));
	assert.match(lines[1], /^ ● bg1 job\.sh +running · \ds$/);
	assert.equal(lines[2], "   step 1");
	// The jobs line leaves out the job while it's open
	assert.deepEqual(pi.ui.widget("background-jobs"), []);

	assert.equal(viewer.handleMouse({ type: "click", button: "left", x: 2, y: 2 }), undefined);
	assert.deepEqual(viewer.handleMouse({ type: "click", button: "left", x: 2, y: 1 }), { handled: true });
	assert.equal(pi.ui.open, undefined);
	await pi.dispose();
});

test("pi -p waits for a running job and lets Pi read its result before exiting", async () => {
	const pi = await bgRun("./scripts/job.sh", ["Started it.", "It finished."], { mode: "print" });
	await pi.session.prompt("run the job");
	assert.equal(text(last(pi, "assistant")), "It finished.");
	await pi.dispose();
});

// Each case waits for the hint, which shows after 3 seconds
for (const [setting, key, data] of [[undefined, "ctrl+b", "\x02"], ["off", undefined, "\x02"]] as const) {
	test(`a running bash command moves to the background with ${key ?? "no key"} when background.key is ${setting ?? "unset"}`, async () => {
		const pi = await startPi({
			extensions,
			settings: setting ? { background: { key: setting } } : {},
			replies: [fauxAssistantMessage(fauxToolCall("bash", { command: "sleep 30" })), fauxAssistantMessage("ok")],
		});
		const prompt = pi.session.prompt("wait");
		await new Promise((r) => setTimeout(r, 3300));
		if (!key) {
			assert.deepEqual(pi.ui.widget("background-jobs"), []);
			assert.equal(pi.ui.input(data), false);
			await pi.session.abort();
			await prompt;
			return await pi.dispose();
		}
		assert.deepEqual(pi.ui.widget("background-jobs"), [`  ${key} to run in background`]);
		assert.equal(pi.ui.input(data), true);
		await prompt;
		assert.match(text(last(pi, "toolResult")), /^Still running after \ds, so it moved to the background as bg1\./);
		assert.match(pi.ui.widget("background-jobs")![0], /^⏵ bg1 sleep 30 · \ds$/);
		await pi.dispose();
	});
}

test("/bg scrolls output, kills a running job on double-tap x or /bg kill, and returns to the list with left arrow", async () => {
	const pi = await startPi({ extensions });
	mkdirSync(join(pi.cwd, "scripts"));
	writeFileSync(join(pi.cwd, "scripts/lines.sh"), "#!/bin/sh\ni=1\nwhile [ $i -le 40 ]; do\n  echo \"line $i\"\n  i=$((i + 1))\ndone\n");
	writeFileSync(join(pi.cwd, "scripts/wait.sh"), "#!/bin/sh\necho waiting\nsleep 30\n");
	chmodSync(join(pi.cwd, "scripts/lines.sh"), 0o755);
	chmodSync(join(pi.cwd, "scripts/wait.sh"), 0o755);
	pi.faux.setResponses([
		fauxAssistantMessage([fauxToolCall("bg_run", { command: "./scripts/lines.sh" }), fauxToolCall("bg_run", { command: "./scripts/wait.sh" }), fauxToolCall("bg_run", { command: "./scripts/wait.sh" })]),
		fauxAssistantMessage("Started."),
		fauxAssistantMessage("Done."),
	]);
	await pi.session.prompt("run jobs");
	await until(() => pi.ui.widget("background-jobs")?.filter((line) => line.includes("waiting")).length === 2);

	// Open bg1 (40 lines) and test scrolling + back-to-list -> pick bg2 -> double-tap x to kill
	const bgCommand = pi.command("/bg bg1");
	let viewer = await until(() => pi.ui.open?.component);
	let rendered = plain(viewer.render(100));
	assert.equal(rendered[2], "   line 21");
	assert.match(rendered.at(-2)!, /↑↓ 21–40\/40 · ← list · esc close/);

	viewer.handleInput("\x1b[A"); // up
	assert.equal(plain(viewer.render(100))[2], "   line 20");
	viewer.handleInput("\x1b[H"); // home
	assert.equal(plain(viewer.render(100))[2], "   line 1");
	viewer.handleMouse({ type: "wheel", button: "none", x: 5, y: 5, wheelDelta: 5 });
	assert.equal(plain(viewer.render(100))[2], "   line 6");
	viewer.handleInput("\x1b[F"); // end
	assert.equal(plain(viewer.render(100))[2], "   line 21");

	// Left arrow goes back to the picker; pick bg2, then cancel on second return
	pi.ui.answers.push((options: string[]) => options.find((o) => o.startsWith("bg2")), undefined);
	viewer.handleInput("\x1b[D");
	await until(() => pi.ui.dialogs.length === 1);
	viewer = await until(() => pi.ui.open?.component && plain(pi.ui.open.component.render(100))[1].includes("bg2") ? pi.ui.open.component : undefined);
	assert.match(plain(viewer.render(100)).at(-2)!, /x kill · ← list · esc close/);

	// Single x warns without killing; another key cancels; double-tap x kills bg2
	viewer.handleInput("x");
	assert.match(plain(viewer.render(100)).at(-2)!, /press x again to kill bg2/);
	viewer.handleInput("j");
	assert.match(plain(viewer.render(100)).at(-2)!, /x kill/);
	viewer.handleInput("x");
	viewer.handleInput("x");
	await until(() => plain(viewer.render(100))[1].includes("killed"));
	viewer.handleInput("\x1b[D");
	await bgCommand;

	// /bg kill stops bg3 directly
	await pi.command("/bg kill 3");
	assert.equal(pi.ui.notes.at(-1)?.message, "Stopping bg3");
	await until(() => pi.ui.widget("background-jobs")?.length === 0);
	await pi.dispose();
});
