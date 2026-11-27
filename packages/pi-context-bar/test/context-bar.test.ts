import assert from "node:assert/strict";
import { test } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { fauxAssistantMessage, plain, startPi } from "../../../test/harness.mts";

const extensions = ["packages/pi-context-bar/extensions/context-bar.ts"];

test("the footer shows the model, branch, context and other extensions' statuses", async () => {
	const pi = await startPi({ extensions, replies: [fauxAssistantMessage("hi")] });
	pi.ui.footerData.getExtensionStatuses = () => new Map([["b-ext", "second"], ["a-ext", "first\n  status"]]);
	await pi.session.prompt("hello");
	const [line] = plain(pi.ui.footer.render(200));
	assert.match(line, /^faux\/faux-1 │ ⎇ main │ Context: \[█*░*\] [\d.]+k\/128\.0k \(\d+%\) │ first status │ second$/);
	await pi.dispose();
});

test("in a narrow terminal the bar shrinks and statuses that don't fit are left out", async () => {
	const pi = await startPi({ extensions });
	pi.ui.footerData.getExtensionStatuses = () => new Map([["a-ext", "a long status that will not fit"]]);
	const [wide] = plain(pi.ui.footer.render(200));
	const [narrow] = plain(pi.ui.footer.render(60));
	assert.ok(visibleWidth(narrow) <= 60);
	assert.match(narrow, /Context: \[░{5,19}\] .*\(0%\)$/);
	assert.ok(wide.includes("a long status") && !narrow.includes("a long status"));
	await pi.dispose();
});
