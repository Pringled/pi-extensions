import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { test } from "node:test";
import { startPi } from "../../../test/harness.mts";
import { startProxy } from "../extensions/feedback.ts";

const listen = (server: Server) => new Promise<string>((resolve) => server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(server.address() as any).port}`)));

test("the proxy adds the Send to Pi button to difit's page and only lets this machine send", async (t) => {
	const difit = createServer((req, res) => {
		if (req.url === "/api") return void res.writeHead(200, { "content-type": "application/json" }).end('{"ok":true}');
		res.writeHead(200, { "content-type": "text/html" }).end("<html><body>diff</body></html>");
	});
	let sent = 0;
	const proxy = await startProxy(new URL(await listen(difit)), () => sent++);
	t.after(() => {
		proxy.close();
		difit.close();
	});
	const base = `http://127.0.0.1:${(proxy.address() as any).port}`;

	const page = await (await fetch(base)).text();
	assert.match(page, /^<html><body>diff<script>.*Send to Pi.*<\/script><\/body><\/html>$/s);
	assert.equal(await (await fetch(`${base}/api`)).text(), '{"ok":true}');

	// Without the header, as a form on another site would send it
	assert.equal((await fetch(`${base}/__pi-feedback/send`, { method: "POST" })).status, 200);
	assert.equal(sent, 0);
	assert.equal((await fetch(`${base}/__pi-feedback/send`, { method: "POST", headers: { "x-pi-feedback": "send" } })).status, 204);
	assert.equal(sent, 1);
});

test("/feedback outside a git repository says it needs one", async () => {
	const pi = await startPi({ extensions: ["packages/pi-feedback/extensions/feedback.ts"] });
	await pi.command("/feedback");
	assert.deepEqual(pi.ui.notes, [{ message: "/feedback needs a git repository", type: "error" }]);
	await pi.dispose();
});
