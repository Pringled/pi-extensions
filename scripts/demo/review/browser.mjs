// Records the browser half of the review demo: difit at <url>, with one comment typed on the median function.
// Usage: node browser.mjs <url> <theme: dark|light> <comment> <out dir>. Writes frame PNGs and frames.json ([{file, seconds}]).
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const [url, theme, comment, outDir] = process.argv.slice(2);
const WIDTH = 1240;
const HEIGHT = 884;
mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// difit keeps its theme in ~/.difit/config.json; switch it for the recording and put the file back afterwards
const configPath = join(homedir(), ".difit", "config.json");
const savedConfig = existsSync(configPath) ? readFileSync(configPath, "utf8") : undefined;
const chrome = spawn(
	"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
	["--headless=new", "--hide-scrollbars", "--remote-debugging-port=9335", `--user-data-dir=${mkdtempSync(join(tmpdir(), "review-demo-"))}`, "about:blank"],
	{ stdio: "ignore" },
);

try {
	await fetch(`${url}/api/user-settings`, {
		method: "PUT",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ client: { appearance: { theme, syntaxTheme: theme === "light" ? "vsLight" : "vsDark" } } }),
	});

	let targets;
	for (let i = 0; i < 40 && !targets; i++) {
		try {
			targets = await (await fetch("http://127.0.0.1:9335/json")).json();
		} catch {
			await sleep(250);
		}
	}
	const ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
	await new Promise((r) => ws.addEventListener("open", r));
	let id = 0;
	const pending = new Map();
	ws.addEventListener("message", (e) => {
		const m = JSON.parse(e.data);
		pending.get(m.id)?.(m.result);
	});
	const send = (method, params = {}) =>
		new Promise((r) => {
			pending.set(++id, r);
			ws.send(JSON.stringify({ id, method, params }));
		});
	const evaluate = async (expression) => (await send("Runtime.evaluate", { expression, returnByValue: true })).result.value;
	const click = async ({ x, y }) => {
		for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 });
	};

	const frames = [];
	const frame = async (seconds) => {
		const shot = await send("Page.captureScreenshot", { format: "png" });
		const file = `frame-${String(frames.length).padStart(3, "0")}.png`;
		writeFileSync(join(outDir, file), Buffer.from(shot.data, "base64"));
		frames.push({ file, seconds });
	};

	await send("Emulation.setDeviceMetricsOverride", { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false });
	await send("Page.navigate", { url });
	await sleep(3000);
	await frame(1.0);

	// Hover the line number of `def median` so its "Add a comment" button shows, then click it
	const line = await evaluate(`(() => {
		const td = [...document.querySelectorAll('td[id$="-right"]')].find((td) => td.textContent.trim() === "14");
		const r = td.getBoundingClientRect();
		return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
	})()`);
	await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: line.x, y: line.y });
	await sleep(300);
	await frame(0.5);
	const add = await evaluate(`(() => {
		const b = [...document.querySelectorAll('button[title="Add a comment"]')].find((b) => Math.abs(b.getBoundingClientRect().y + b.getBoundingClientRect().height / 2 - ${line.y}) < 15);
		const r = b.getBoundingClientRect();
		return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
	})()`);
	await click(add);
	await sleep(400);
	await frame(0.4);

	// Type the comment a few characters at a time
	for (let i = 0; i < comment.length; i += 3) {
		await send("Input.insertText", { text: comment.slice(i, i + 3) });
		await sleep(30);
		await frame(0.06);
	}
	await frame(0.5);

	const submit = await evaluate(`(() => {
		const r = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Submit").getBoundingClientRect();
		return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
	})()`);
	await click(submit);
	await sleep(500);
	await frame(1.4);

	writeFileSync(join(outDir, "frames.json"), JSON.stringify(frames));
	ws.close();
} finally {
	chrome.kill();
	if (savedConfig !== undefined) writeFileSync(configPath, savedConfig);
}
