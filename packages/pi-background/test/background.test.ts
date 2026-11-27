import assert from "node:assert/strict";
import { chmodSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fauxAssistantMessage, fauxToolCall, plain, type PiOptions, startPi, until } from "../../../test/harness.mts";

const extensions = ["packages/pi-background/extensions/background.ts"];
const text = (message: any) => (typeof message.content === "string" ? message.content : message.content.map((c: any) => c.text ?? "").join(""));
const last = (pi: { session: any }, role: string) => pi.session.messages.filter((m: any) => m.role === role).at(-1);

/** A session whose model starts the command with bg_run and then answers each message with the given replies. */
async function bgRun(command: (cwd: string) => string, replies: string[], options: Partial<PiOptions> = {}) {
	const pi = await startPi({ extensions, ...options });
	writeFileSync(join(pi.cwd, "job.sh"), "echo step 1\nsleep 1\necho finished\n");
	chmodSync(join(pi.cwd, "job.sh"), 0o755);
	pi.faux.setResponses([fauxAssistantMessage(fauxToolCall("bg_run", { command: command(pi.cwd) })), ...replies.map((reply) => fauxAssistantMessage(reply))]);
	return pi;
}

test("a bg_run job shows in the jobs line while it runs and wakes Pi with its result when it exits", async () => {
	const pi = await bgRun((cwd) => `cd ${cwd} && PYTHONPATH=/some/src ${cwd}/job.sh`, ["Started it.", "It finished."]);
	await pi.session.prompt("run the job");
	assert.match((await until(() => pi.ui.widget("background-jobs")?.find((line) => line.includes("step 1"))))!, /^⏵ bg1 job\.sh · \ds · step 1$/);

	await until(() => text(last(pi, "assistant")) === "It finished.", 10_000);
	const report = pi.session.messages.find((m: any) => m.customType === "background-job");
	assert.match(text(report), /^Background job finished: bg1 \[exit 0, \ds\][^]*Last lines:\nstep 1\nfinished$/);
	assert.deepEqual(pi.ui.widget("background-jobs"), []);
	await pi.dispose();
});

test("clicking a job in the jobs line opens its output, and clicking the title closes it", async () => {
	const pi = await bgRun((cwd) => `${cwd}/job.sh`, ["Started it.", "It finished."]);
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
	const pi = await bgRun((cwd) => `${cwd}/job.sh`, ["Started it.", "It finished."], { mode: "print" });
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
