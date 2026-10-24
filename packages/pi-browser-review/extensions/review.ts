import { type ChildProcess, spawn } from "node:child_process";
import { createServer, request, type Server } from "node:http";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const RULE = "=".repeat(50);
const SEND_PATH = "/__pi-review/send";
// A self-contained floating button, so it doesn't depend on how difit builds its page
const BUTTON = `<script>(() => {
	const b = document.createElement("button");
	b.textContent = "Send to Pi";
	Object.assign(b.style, { position: "fixed", right: "24px", bottom: "24px", zIndex: 2147483647, padding: "10px 18px", border: "0", borderRadius: "8px",
		background: "#238636", color: "#fff", font: "600 14px -apple-system, system-ui, sans-serif", cursor: "pointer", boxShadow: "0 4px 12px rgba(0,0,0,.3)" });
	b.onclick = async () => {
		b.disabled = true;
		b.textContent = "Sending…";
		await new Promise((r) => setTimeout(r, 400));
		const res = await fetch("${SEND_PATH}", { method: "POST", headers: { "x-pi-review": "send" } }).catch(() => undefined);
		b.textContent = res?.ok ? "Sent to Pi" : "Couldn't reach Pi";
		b.disabled = Boolean(res?.ok);
	};
	document.body.appendChild(b);
})();</script>`;

/** A local server in front of difit that passes everything through and adds the Send to Pi button to its page. Exported for the demo recording. */
export function startProxy(target: URL, onSend: () => void): Promise<Server> {
	const server = createServer((req, res) => {
		// Only this machine's own addresses, so a website can't reach the review through DNS rebinding
		if (!/^(127\.0\.0\.1|localhost):\d+$/.test(req.headers.host ?? "")) return void res.writeHead(403).end();
		// The header makes browsers block requests from other sites, so they can't end the review
		if (req.method === "POST" && req.url === SEND_PATH && req.headers["x-pi-review"] === "send") {
			onSend();
			return void res.writeHead(204).end();
		}
		const headers = { ...req.headers, host: target.host };
		// Uncompressed, so the button can be added to the HTML
		delete headers["accept-encoding"];
		const upstream = request({ hostname: target.hostname, port: target.port, path: req.url, method: req.method, headers }, (up) => {
			if (!String(up.headers["content-type"]).startsWith("text/html")) {
				res.writeHead(up.statusCode ?? 502, up.headers);
				return void up.pipe(res);
			}
			let html = "";
			up.on("data", (d: Buffer) => (html += d.toString()));
			up.on("end", () => {
				const { "content-length": _, ...rest } = up.headers;
				res.writeHead(up.statusCode ?? 200, rest).end(html.includes("</body>") ? html.replace("</body>", `${BUTTON}</body>`) : html + BUTTON);
			});
		});
		upstream.on("error", () => res.writeHead(502).end());
		req.pipe(upstream);
	});
	return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

/** The comments block difit prints when it stops, between two rules after the "Comments from review session" heading. */
function reviewComments(output: string): string {
	const start = output.indexOf("Comments from review session:");
	if (start === -1) return "";
	const [, body = ""] = output.slice(start).split(RULE);
	return body.trim();
}

export default function (pi: ExtensionAPI) {
	// The open review: difit's process and how to finish it
	let review: { child: ChildProcess; stop: () => void } | undefined;

	const git = async (cwd: string, ...args: string[]) => {
		const result = await pi.exec("git", args, { cwd });
		return result.code === 0 ? result.stdout.trim() : "";
	};

	// The branch to compare with: the remote's default branch, else main or master, unless that's the current branch
	const defaultBase = async (cwd: string) => {
		const remoteHead = (await git(cwd, "symbolic-ref", "--short", "refs/remotes/origin/HEAD")).replace(/^origin\//, "");
		const candidates = remoteHead ? [remoteHead] : ["main", "master"];
		const current = await git(cwd, "branch", "--show-current");
		for (const name of candidates) {
			if (name === current) continue;
			for (const ref of [name, `origin/${name}`]) if (await git(cwd, "rev-parse", "--verify", "--quiet", ref)) return ref;
		}
		return undefined;
	};

	pi.registerCommand("review", {
		description: "Review your changes in the browser with difit; send your line comments to Pi with the button there or /review again. Optionally pass the branch to compare with",
		handler: async (args, ctx) => {
			// A second /review finishes the open one; difit prints the comments on its way out
			if (review) return review.stop();
			if (!(await git(ctx.cwd, "rev-parse", "--is-inside-work-tree"))) return ctx.ui.notify("/review needs a git repository", "error");

			// Everything on this branch since it left the base, uncommitted changes and new files included
			const base = args.trim() || (await defaultBase(ctx.cwd));
			// --keep-alive so reloading or closing the tab doesn't end the review, --clean so earlier comments the browser saved aren't sent again
			// --no-open because the browser should open the address with the button, not difit's own
			const difitArgs = [".", ...(base ? [base, "--merge-base"] : []), "--include-untracked", "--keep-alive", "--clean", "--no-open"];
			// difit marks new files with git add --intent-to-add to show them; this undoes that afterwards
			const untracked = (await git(ctx.cwd, "ls-files", "--others", "--exclude-standard")).split("\n").filter(Boolean);
			let output = "";
			let empty = false;
			let shown = false;
			let proxy: Server | undefined;
			// Where difit's output stood when it was asked to stop; what it prints after that is its answer
			let stoppedAt = Number.POSITIVE_INFINITY;
			const child = spawn("difit", difitArgs, { cwd: ctx.cwd, stdio: ["ignore", "pipe", "pipe"] });
			const stop = () => {
				stoppedAt = output.length;
				child.kill("SIGINT");
			};
			review = { child, stop };

			const done = () => {
				review = undefined;
				ctx.ui.setWidget("review", undefined);
				proxy?.closeAllConnections();
				proxy?.close();
				// One at a time, so a file deleted meanwhile doesn't stop the others
				for (const file of untracked) void git(ctx.cwd, "reset", "--quiet", "--", file);
			};
			child.on("error", (err: NodeJS.ErrnoException) => {
				done();
				const hint = err.code === "ENOENT" ? "difit isn't installed; install it with: npm install -g difit" : err.message;
				ctx.ui.notify(`/review: ${hint}`, "error");
			});
			child.stderr?.on("data", (d: Buffer) => (output += d.toString()));
			child.stdout?.on("data", (d: Buffer) => {
				output += d.toString();
				// The first local address difit prints, whatever the text around it
				const url = output.match(/https?:\/\/(localhost|127\.0\.0\.1|\[::1\]):\d+/)?.[0];
				if (!empty && /No differences found/.test(output)) {
					empty = true;
					child.kill("SIGINT");
					return ctx.ui.notify(`Nothing to review${base ? ` against ${base}` : ""}`, "info");
				}
				if (url && !empty && !shown) {
					shown = true;
					void startProxy(new URL(url), stop).then((server) => {
						proxy = server;
						const address = server.address();
						const page = `http://127.0.0.1:${typeof address === "object" && address ? address.port : ""}`;
						// Opening the browser can fail, for example in a sandbox; the address is shown either way
						void pi.exec(process.platform === "darwin" ? "open" : "xdg-open", [page]).catch(() => {});
						ctx.ui.setWidget("review", (_tui, theme) => ({
							invalidate() {},
							render: () => [theme.fg("dim", ` ◆ Reviewing in the browser at ${page}; press Send to Pi there or run /review again`)],
						}));
					});
				}
			});
			child.on("close", (code) => {
				if (review?.child !== child) return;
				done();
				if (empty) return;
				const comments = reviewComments(output);
				if (comments) pi.sendUserMessage(`Here are my review comments on the changes${base ? ` against ${base}` : ""}:\n\n${comments}`, { deliverAs: "followUp" });
				// difit mentioned comments in a form this doesn't recognise, so say so rather than lose them quietly
				else if (/comment/i.test(output.slice(stoppedAt))) ctx.ui.notify("/review couldn't read difit's comments; copy them with Copy All Prompt in difit instead", "warning");
				else if (code === 0) ctx.ui.notify("Review closed without comments", "info");
				else ctx.ui.notify(`/review: difit stopped (exit ${code}). ${output.trim().split("\n").at(-1) ?? ""}`, "error");
			});
		},
	});

	pi.on("session_shutdown", async () => {
		review?.child.kill("SIGINT");
	});
}
