import { type ChildProcess, execFile, spawn } from "node:child_process";
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer, request, type Server } from "node:http";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const RULE = "=".repeat(50);
const SEND_PATH = "/__pi-feedback/send";
const DONE_PATH = "/__pi-feedback/done";
const STATUS_PATH = "/__pi-feedback/status";
// Untracked files larger than this are left out of the snapshot, so a dataset or build output isn't copied into .git
const SNAPSHOT_MAX_BYTES = 1_000_000;
// How often the review checks for Pi's changes while it waits for them
const WAIT_POLL_MS = 2000;
const LEFT_OUT = "Left out as too large (size, modified, path):";

const BUTTON_STYLE = `{ padding: "10px 18px", border: "0", borderRadius: "8px", color: "#fff", font: "600 14px -apple-system, system-ui, sans-serif", cursor: "pointer", boxShadow: "0 4px 12px rgba(0,0,0,.3)" }`;
// Self-contained floating buttons, so they don't depend on how difit builds its page. After a send the page reloads,
// which shows the changes since then, or a waiting page until Pi has made some
const CONTROLS = (withSend: boolean) => `<script>(() => {
	const bar = document.createElement("div");
	Object.assign(bar.style, { position: "fixed", right: "24px", bottom: "24px", zIndex: 2147483647, display: "flex", gap: "8px" });
	const button = (label, background) => {
		const b = document.createElement("button");
		b.textContent = label;
		Object.assign(b.style, ${BUTTON_STYLE}, { background });
		bar.appendChild(b);
		return b;
	};
	const post = (path) => fetch(path, { method: "POST", headers: { "x-pi-feedback": "send" } }).then((r) => r.json()).catch(() => undefined);
	const done = button("Done", "#57606a");
	${withSend ? `const send = button("Send to Pi", "#238636");
	send.onclick = async () => {
		send.disabled = true;
		send.textContent = "Sending…";
		await new Promise((r) => setTimeout(r, 400));
		const res = await post("${SEND_PATH}");
		if (res?.sent) {
			send.textContent = "Sent to Pi";
			setTimeout(() => location.reload(), 600);
			return;
		}
		send.textContent = res ? "No comments yet" : "Couldn't reach Pi";
		setTimeout(() => ((send.textContent = "Send to Pi"), (send.disabled = false)), 2000);
	};` : ""}
	done.onclick = async () => {
		done.disabled = true;
		const res = await post("${DONE_PATH}");
		document.body.innerHTML = '<p style="font: 16px -apple-system, system-ui, sans-serif; margin: 48px">' +
			(res ? "Review finished" + (res.sent ? "; your comments went to Pi" : "") + ". You can close this tab." : "Couldn't reach Pi.") + "</p>";
	};
	document.body.appendChild(bar);
})();</script>`;
const WAITING_PAGE = `<!doctype html><meta charset="utf-8"><title>Waiting for Pi</title>
<body style="font: 16px -apple-system, system-ui, sans-serif; margin: 48px; color: #57606a">
<p>Feedback sent. Waiting for Pi's changes; they show here as soon as Pi makes some.</p>
<script>setInterval(() => fetch("${STATUS_PATH}").then((r) => r.json()).then((s) => s.ready && location.reload()).catch(() => {}), 1500);</script>
${CONTROLS(false)}</body>`;

/**
 * A local server in front of difit that passes everything through and adds the Send to Pi and Done buttons to its page.
 * While there is no difit to show, between a send and Pi's first change, it shows a waiting page. Exported for the demo
 * recording.
 */
export function startProxy(
	target: URL | (() => URL | undefined),
	onSend: () => unknown,
	onDone: () => unknown = () => {},
	beforeDiff: () => Promise<unknown> = async () => {},
): Promise<Server> {
	const current = typeof target === "function" ? target : () => target;
	const server = createServer(async (req, res) => {
		// Only this machine's own addresses, so a website can't reach the review through DNS rebinding
		if (!/^(127\.0\.0\.1|localhost):\d+$/.test(req.headers.host ?? "")) return void res.writeHead(403).end();
		// The header makes browsers block requests from other sites, so they can't send or end the review
		const action = req.method === "POST" && req.headers["x-pi-feedback"] === "send" ? { [SEND_PATH]: onSend, [DONE_PATH]: onDone }[req.url ?? ""] : undefined;
		if (action) {
			const result = await Promise.resolve(action()).catch(() => undefined);
			return void res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(result ?? { sent: true }));
		}
		const upstreamUrl = current();
		if (req.url === STATUS_PATH) return void res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ready: Boolean(upstreamUrl) }));
		if (!upstreamUrl) {
			if (req.url === "/" || String(req.headers.accept).includes("text/html")) return void res.writeHead(200, { "content-type": "text/html" }).end(WAITING_PAGE);
			return void res.writeHead(503).end();
		}
		// difit only picks up untracked files when it starts, so new ones are marked before each diff it serves
		if (req.url?.startsWith("/api/diff")) await beforeDiff().catch(() => {});
		const headers = { ...req.headers, host: upstreamUrl.host };
		// Uncompressed, so the buttons can be added to the HTML
		delete headers["accept-encoding"];
		const upstream = request({ hostname: upstreamUrl.hostname, port: upstreamUrl.port, path: req.url, method: req.method, headers }, (up) => {
			if (!String(up.headers["content-type"]).startsWith("text/html")) {
				res.writeHead(up.statusCode ?? 502, up.headers);
				return void up.pipe(res);
			}
			let html = "";
			up.on("data", (d: Buffer) => (html += d.toString()));
			up.on("end", () => {
				const { "content-length": _, ...rest } = up.headers;
				const controls = CONTROLS(true);
				res.writeHead(up.statusCode ?? 200, rest).end(html.includes("</body>") ? html.replace("</body>", `${controls}</body>`) : html + controls);
			});
		});
		upstream.on("error", () => res.writeHead(502).end());
		req.pipe(upstream);
	});
	return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

/** The difit that comes with this package, run with the Node that runs Pi, or else a difit on PATH. */
function difitCommand(): [string, string[]] {
	try {
		const manifest = createRequire(import.meta.url).resolve("difit/package.json");
		const bin = JSON.parse(readFileSync(manifest, "utf8")).bin;
		return [process.execPath, [join(dirname(manifest), typeof bin === "string" ? bin : bin.difit)]];
	} catch {
		return ["difit", []];
	}
}

/** The comments block difit prints, between two rules after the "Comments from review session" heading. */
function reviewComments(output: string): string {
	const start = output.indexOf("Comments from review session:");
	if (start === -1) return "";
	const [, body = ""] = output.slice(start).split(RULE);
	return body.trim();
}

// Size and modification time, to tell later whether a file left out of the snapshot has changed since
function stamp(cwd: string, file: string) {
	try {
		const { size, mtimeMs } = statSync(join(cwd, file));
		return { size, stamp: `${size}\t${Math.floor(mtimeMs)}` };
	} catch {
		return undefined;
	}
}

/** One difit run behind the proxy: where it serves, how to show files created since it started, and how to stop it. */
interface Round {
	child: ChildProcess;
	url: URL;
	markNew: () => Promise<void>;
	stop: () => Promise<void>;
}

export default function (pi: ExtensionAPI) {
	// The open review, and how to end it
	let review: { finish: () => Promise<unknown>; close: () => void } | undefined;

	const git = async (cwd: string, ...args: string[]) => {
		const result = await pi.exec("git", args, { cwd });
		return result.code === 0 ? result.stdout.trim() : "";
	};

	// Where the snapshot of what was last sent for this branch is kept: a ref outside refs/heads, so it isn't a branch and
	// isn't pushed
	const snapshotRef = async (cwd: string) => `refs/pi-feedback/${(await git(cwd, "branch", "--show-current")) || "HEAD"}`;

	// The files as they are now, uncommitted changes and small untracked files included, as a tree, plus the large untracked
	// files left out of it. It goes through its own index, so what is staged is left alone
	const currentTree = async (cwd: string) => {
		const index = join(tmpdir(), `pi-feedback-index-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		const env = { ...process.env, GIT_INDEX_FILE: index, GIT_AUTHOR_NAME: "pi-feedback", GIT_AUTHOR_EMAIL: "pi-feedback@localhost", GIT_COMMITTER_NAME: "pi-feedback", GIT_COMMITTER_EMAIL: "pi-feedback@localhost" };
		const run = (...args: string[]) =>
			new Promise<string>((resolve, reject) => execFile("git", args, { cwd, env, maxBuffer: 64 * 1024 * 1024 }, (err, stdout) => (err ? reject(err) : resolve(stdout.trim()))));
		try {
			await run("read-tree", "HEAD");
			await run("add", "--update");
			const untracked = (await run("ls-files", "--others", "--exclude-standard", "-z")).split("\0").filter(Boolean);
			const small: string[] = [];
			const large: string[] = [];
			for (const file of untracked) {
				const info = stamp(cwd, file);
				if (info && info.size <= SNAPSHOT_MAX_BYTES) small.push(file);
				else if (info) large.push(`${info.stamp}\t${file}`);
			}
			for (let i = 0; i < small.length; i += 200) await run("add", "--", ...small.slice(i, i + 200));
			return { tree: await run("write-tree"), large, run };
		} finally {
			rmSync(index, { force: true });
		}
	};
	const leftOut = async (cwd: string, ref: string) => (await git(cwd, "log", "-1", "--format=%B", ref)).split(LEFT_OUT)[1]?.trim().split("\n") ?? [];

	// Saves the files as they are now as a commit on top of HEAD, under the snapshot ref; nothing changes on the branch
	const snapshot = async (cwd: string) => {
		try {
			const { tree, large, run } = await currentTree(cwd);
			const message = ["pi-feedback: the files when feedback was sent", ...(large.length ? ["", LEFT_OUT, ...large] : [])].join("\n");
			const commit = await run("commit-tree", "--no-gpg-sign", tree, "-p", "HEAD", "-m", message);
			await run("update-ref", await snapshotRef(cwd), commit);
			return true;
		} catch {
			return false;
		}
	};

	// The state of the files if it differs from the last snapshot, counting large untracked files by size and
	// modification time, or "" if it doesn't
	const changedSince = async (cwd: string, ref: string) => {
		try {
			const now = await currentTree(cwd);
			const state = `${now.tree}\n${now.large.join("\n")}`;
			return state === `${await git(cwd, "rev-parse", `${ref}^{tree}`)}\n${(await leftOut(cwd, ref)).join("\n")}` ? "" : state;
		} catch {
			return "";
		}
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

	// Starts difit on the changes against base, or with since, against the snapshot. Resolves once it serves, or with
	// "empty" when there is nothing to show, or with an error message
	const startRound = async (cwd: string, base: string | undefined, since: boolean, onCrash: (message: string) => void): Promise<Round | "empty" | string> => {
		const ref = await snapshotRef(cwd);
		// difit marks new files with git add --intent-to-add to show them; this undoes that afterwards
		const untracked = (await git(cwd, "ls-files", "--others", "--exclude-standard")).split("\n").filter(Boolean);
		// The snapshot leaves out large untracked files, so the ones that haven't changed since would show up as new every
		// time. difit's own git ignores them through a temporary excludes file, which keeps the user's global ignores
		let excludes: string | undefined;
		let same: string[] = [];
		if (since) {
			const recorded = new Set(await leftOut(cwd, ref));
			same = untracked.filter((file) => recorded.has(`${stamp(cwd, file)?.stamp}\t${file}`));
			if (same.length) {
				const global = (await git(cwd, "config", "--path", "--get", "core.excludesFile")) || join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "git", "ignore");
				excludes = join(tmpdir(), `pi-feedback-excludes-${process.pid}-${Date.now()}`);
				const escaped = same.map((file) => `/${file.replace(/[\\*?[\]!#]/g, "\\$&").replace(/ $/, "\\ ")}`);
				writeFileSync(excludes, [existsSync(global) ? readFileSync(global, "utf8") : "", ...escaped].join("\n"));
			}
		}
		// --keep-alive so reloading or closing the tab doesn't end the review, --clean so earlier comments the browser saved
		// aren't sent again, --no-open because the browser should open the address with the buttons, not difit's own
		const args = [".", ...(since ? [ref] : base ? [base, "--merge-base"] : []), "--include-untracked", "--keep-alive", "--clean", "--no-open"];
		const [command, prefix] = difitCommand();
		const env = excludes ? { ...process.env, GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "core.excludesFile", GIT_CONFIG_VALUE_0: excludes } : process.env;
		const child = spawn(command, [...prefix, ...args], { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
		let cleaned: Promise<void> | undefined;
		// File by file, so one deleted meanwhile doesn't stop the others, and one after another, since git commands running
		// at the same time fight over the index lock and some would quietly fail
		const cleanup = () =>
			(cleaned ??= (async () => {
				if (excludes) rmSync(excludes, { force: true });
				for (const file of untracked) await git(cwd, "reset", "--quiet", "--", file);
			})());
		// Files created while difit runs, marked like difit marks the ones there at the start, and undone the same way
		const marked = new Set([...untracked, ...same]);
		const markNew = async () => {
			if (cleaned) return;
			const fresh = (await git(cwd, "ls-files", "--others", "--exclude-standard")).split("\n").filter((file) => file && !marked.has(file));
			if (!fresh.length) return;
			for (const file of fresh) marked.add(file);
			untracked.push(...fresh);
			await git(cwd, "add", "--intent-to-add", "--", ...fresh);
		};
		return new Promise((resolve) => {
			let output = "";
			let settled = false;
			let stopping = false;
			let probing = false;
			const settle = (result: Round | "empty" | string) => {
				if (settled) return;
				settled = true;
				resolve(result);
			};
			const stop = () =>
				new Promise<void>((done) => {
					stopping = true;
					if (child.exitCode !== null) return void cleanup().then(done);
					const force = setTimeout(() => child.kill("SIGKILL"), 5000);
					child.once("close", () => (clearTimeout(force), void cleanup().then(done)));
					child.kill("SIGINT");
				});
			child.on("error", (err: NodeJS.ErrnoException) => {
				void cleanup();
				settle(err.code === "ENOENT" ? "difit wasn't found; reinstall pi-feedback with: pi install npm:pi-feedback" : err.message);
			});
			child.stderr?.on("data", (d: Buffer) => (output += d.toString()));
			child.stdout?.on("data", async (d: Buffer) => {
				output += d.toString();
				// The first local address difit prints, whatever the text around it
				const url = output.match(/https?:\/\/(localhost|127\.0\.0\.1|\[::1\]):\d+/)?.[0];
				if (!url || probing) return;
				probing = true;
				// difit prints its address before it says whether there are differences, and keeps serving either way, so
				// its own diff says whether there is anything to review
				const files = await fetch(new URL("/api/diff", url))
					.then((r) => r.json())
					.then((diff: { files?: unknown[] }) => diff.files?.length ?? 1)
					.catch(() => 1);
				if (files === 0) {
					await stop();
					return settle("empty");
				}
				settle({ child, url: new URL(url), markNew, stop });
			});
			child.on("close", (code) => {
				void cleanup();
				// A stop this started is settled by whoever started it, once difit's changes are undone
				if (stopping) return;
				const reason = `difit stopped (exit ${code}). ${output.trim().split("\n").at(-1) ?? ""}`;
				if (!settled) return settle(reason);
				onCrash(reason);
			});
		});
	};

	pi.registerCommand("feedback", {
		description:
			"Give Pi feedback on its changes: comment on lines in a GitHub-style view in your browser and press Send to Pi; the page then shows Pi's changes since. Done there, or /feedback again, ends it. Pass a branch to compare with, or 'since' for only what changed since your last feedback",
		handler: async (args, ctx) => {
			// A second /feedback ends the open review, sending any comments left
			if (review) return void (await review.finish());
			if (!(await git(ctx.cwd, "rev-parse", "--is-inside-work-tree"))) return ctx.ui.notify("/feedback needs a git repository", "error");

			// Everything on this branch since it left the base, uncommitted changes and new files included; with "since", only
			// what changed after the last feedback was sent, compared with the files as they were then
			const since = args.trim() === "since";
			const ref = await snapshotRef(ctx.cwd);
			if (since && !(await git(ctx.cwd, "rev-parse", "--verify", "--quiet", ref)))
				return ctx.ui.notify("No feedback sent on this branch yet; /feedback shows the whole branch", "info");
			const base = since ? undefined : args.trim() || (await defaultBase(ctx.cwd));
			let about = since ? "since your last feedback" : base ? `against ${base}` : "";

			let round: Round | undefined;
			let proxy: Server | undefined;
			let poll: NodeJS.Timeout | undefined;
			let page = "";
			let sentAny = false;
			let ended = false;

			const widget = (text: string) =>
				ctx.ui.setWidget("feedback", (_tui, theme) => ({ invalidate() {}, render: () => [theme.fg("dim", ` ◆ ${text}`)] }));
			const reviewing = () => widget(`Reviewing in the browser at ${page}; press Send to Pi there, and Done or /feedback when you're finished`);
			const comments = async () => {
				if (!round) return "";
				try {
					return reviewComments(await (await fetch(new URL("/api/comments-output", round.url))).text());
				} catch {
					return "";
				}
			};
			// The snapshot comes first, so none of Pi's changes in answer to the feedback end up in it
			const deliver = async (text: string) => {
				const saved = await snapshot(ctx.cwd);
				pi.sendUserMessage(`Here's my feedback on the changes${about ? ` ${about}` : ""}:\n\n${text}`, { deliverAs: "followUp" });
				about = "since your last feedback";
				sentAny = true;
				return saved;
			};
			const close = () => {
				ended = true;
				review = undefined;
				clearInterval(poll);
				ctx.ui.setWidget("feedback", undefined);
				// After the response to Done has gone out
				setTimeout(() => {
					proxy?.closeAllConnections();
					proxy?.close();
				}, 200);
			};
			const crashed = (message: string) => {
				if (ended) return;
				round = undefined;
				close();
				ctx.ui.notify(`/feedback: ${message}`, "error");
			};
			// After a send, checks for Pi's changes and shows them as soon as there are some
			const waitForChanges = () => {
				let checking = false;
				// A change difit doesn't show, such as a deleted large file the snapshot left out, isn't retried until the files
				// change again
				let nothingToShow = "";
				poll = setInterval(async () => {
					if (checking || ended) return;
					checking = true;
					const state = await changedSince(ctx.cwd, ref);
					if (state && state !== nothingToShow) {
						const next = await startRound(ctx.cwd, undefined, true, crashed);
						if (ended) {
							if (typeof next === "object") await next.stop();
						} else if (typeof next === "object") {
							clearInterval(poll);
							round = next;
							reviewing();
						} else if (next === "empty") nothingToShow = state;
						else crashed(next);
					}
					checking = false;
				}, WAIT_POLL_MS);
			};
			const send = async () => {
				if (!round) return { sent: false };
				const text = await comments();
				if (!text) return { sent: false };
				const saved = await deliver(text);
				const old = round;
				round = undefined;
				await old.stop();
				// Without a snapshot there is nothing to compare Pi's changes with, so the review ends here
				if (!saved) {
					close();
					return { sent: true, done: true };
				}
				widget(`Feedback sent; ${page} shows Pi's changes as they come in. Done or /feedback ends the review`);
				waitForChanges();
				return { sent: true };
			};
			const finish = async () => {
				if (ended) return { sent: false };
				const text = await comments();
				if (text) await deliver(text);
				await round?.stop();
				round = undefined;
				close();
				if (!text && !sentAny) ctx.ui.notify("No feedback sent: you didn't leave any comments", "info");
				return { sent: Boolean(text) };
			};

			const first = await startRound(ctx.cwd, base, since, crashed);
			if (first === "empty") return ctx.ui.notify(`Nothing to review${about ? ` ${about}` : ""}`, "info");
			if (typeof first === "string") return ctx.ui.notify(`/feedback: ${first}`, "error");
			round = first;
			review = {
				finish,
				close: () => {
					void round?.stop();
					close();
				},
			};
			proxy = await startProxy(() => round?.url, send, finish, async () => round?.markNew());
			const address = proxy.address();
			page = `http://127.0.0.1:${typeof address === "object" && address ? address.port : ""}`;
			// Opening the browser can fail, for example in a sandbox; the address is shown either way
			void pi.exec(process.platform === "darwin" ? "open" : "xdg-open", [page]).catch(() => {});
			reviewing();
		},
	});

	pi.on("session_shutdown", async () => {
		review?.close();
	});
}
