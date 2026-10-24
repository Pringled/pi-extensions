import { type ChildProcess, spawn } from "node:child_process";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const RULE = "=".repeat(50);

/** The comments block difit prints when its tab closes, between two rules after the "Comments from review session" heading. */
function reviewComments(output: string): string {
	const start = output.indexOf("Comments from review session:");
	if (start === -1) return "";
	const [, body = ""] = output.slice(start).split(RULE);
	return body.trim();
}

export default function (pi: ExtensionAPI) {
	let difit: ChildProcess | undefined;

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
		description: "Review your changes in the browser with difit; run /review again to send your line comments to Pi. Optionally pass the branch to compare with",
		handler: async (args, ctx) => {
			// A second /review finishes the open one; difit prints the comments on its way out
			if (difit) return void difit.kill("SIGINT");
			if (!(await git(ctx.cwd, "rev-parse", "--is-inside-work-tree"))) return ctx.ui.notify("/review needs a git repository", "error");

			// Everything on this branch since it left the base, uncommitted changes and new files included
			const base = args.trim() || (await defaultBase(ctx.cwd));
			// --keep-alive so reloading or closing the tab doesn't end the review, --clean so earlier comments the browser saved aren't sent again
			const difitArgs = [".", ...(base ? [base, "--merge-base"] : []), "--include-untracked", "--keep-alive", "--clean"];
			// difit marks new files with git add --intent-to-add to show them; this undoes that afterwards
			const untracked = (await git(ctx.cwd, "ls-files", "--others", "--exclude-standard")).split("\n").filter(Boolean);
			let output = "";
			let empty = false;
			let shown = false;
			const child = spawn("difit", difitArgs, { cwd: ctx.cwd, stdio: ["ignore", "pipe", "pipe"] });
			difit = child;

			const done = () => {
				difit = undefined;
				ctx.ui.setWidget("review", undefined);
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
				const url = output.match(/server started on (\S+)/)?.[1];
				if (!empty && /No differences found/.test(output)) {
					empty = true;
					child.kill("SIGINT");
					return ctx.ui.notify(`Nothing to review${base ? ` against ${base}` : ""}`, "info");
				}
				if (url && !empty && !shown) {
					shown = true;
					ctx.ui.setWidget("review", (_tui, theme) => ({
						invalidate() {},
						render: () => [theme.fg("dim", ` ◆ Reviewing in the browser at ${url}; run /review again to send your comments to Pi`)],
					}));
				}
			});
			child.on("close", (code) => {
				if (difit !== child) return;
				done();
				if (empty) return;
				const comments = reviewComments(output);
				if (comments) pi.sendUserMessage(`Here are my review comments on the changes${base ? ` against ${base}` : ""}:\n\n${comments}`, { deliverAs: "followUp" });
				else if (code === 0) ctx.ui.notify("Review closed without comments", "info");
				else ctx.ui.notify(`/review: difit stopped (exit ${code}). ${output.trim().split("\n").at(-1) ?? ""}`, "error");
			});
		},
	});

	pi.on("session_shutdown", async () => {
		difit?.kill("SIGINT");
	});
}
