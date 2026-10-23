import { createWriteStream, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLocalBashOperations, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text, truncateToWidth } from "@earendil-works/pi-tui";
import { Type } from "typebox";

const TAIL_LINES = 20;
const TAIL_BYTES = 64 * 1024;
const BASH_DEFAULT_TIMEOUT = 120;
const BASH_MAX_TIMEOUT = 600;
const WAKE_DEBOUNCE_MS = 1000;
const MAX_WAKES = 10;
const MAX_SHOWN_JOBS = 3;

interface Job {
	id: string;
	command: string;
	log: string;
	started: number;
	controller: AbortController;
	status: "running" | "exited" | "killed" | "failed";
	exitCode?: number | null;
	ended?: number;
	// The latest output line, shown while the job runs
	lastLine?: string;
}

function tail(path: string, lines: number): string {
	try {
		const text = readFileSync(path).subarray(-TAIL_BYTES).toString("utf8");
		return text.trimEnd().split("\n").slice(-lines).join("\n") || "(no output)";
	} catch {
		return "(no output)";
	}
}

function elapsed(job: Job): string {
	const s = Math.round(((job.ended ?? Date.now()) - job.started) / 1000);
	return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${s % 60}s`;
}

function summary(job: Job): string {
	const state = job.status === "exited" ? `exit ${job.exitCode}` : job.status;
	return `${job.id} [${state}, ${elapsed(job)}] ${job.command}\n  log: ${job.log}`;
}

/** The part of a command worth showing: its first line, without a leading cd and with a script path shortened to its name. */
function shownCommand(command: string): string {
	return command
		.split("\n")[0]
		.replace(/^\s*(cd\s+("[^"]*"|'[^']*'|\S+)\s*(&&|;)\s*)+/, "")
		.replace(/^\S*\/(?=[^\s/]+(\s|$))/, "");
}

/** True when a command starts a job with a bare & (not &&, 2>&1, &> or |&). */
function startsBackgroundJob(command: string): boolean {
	return /&/.test(command.replace(/&&|[0-9]*>&[0-9-]*|&>>?|\|&/g, ""));
}

/** Compiles wake_on, accepting Python's (?i) prefix that models often write but JavaScript only takes as a flag. */
function wakePattern(source: string): RegExp {
	const insensitive = source.startsWith("(?i)");
	return new RegExp(insensitive ? source.slice(4) : source, insensitive ? "i" : "");
}

export default function (pi: ExtensionAPI) {
	// Pi's bash has no default timeout, so a stuck or polling command blocks until interrupted; cap it like Claude Code
	// does. A timeout SIGKILLs the command's whole process group, which would include jobs it started with &, so a
	// command that backgrounds something is never timed out, even if the model asked for a timeout.
	pi.on("tool_call", async (event) => {
		if (event.toolName !== "bash") return;
		const input = event.input as { command?: string; timeout?: number };
		if (startsBackgroundJob(String(input.command ?? ""))) delete input.timeout;
		else input.timeout = Math.min(input.timeout ?? BASH_DEFAULT_TIMEOUT, BASH_MAX_TIMEOUT);
	});

	const jobs = new Map<string, Job>();
	const ops = createLocalBashOperations();
	let next = 1;

	const wake = (content: string, details: { headline: string; last: string; error: boolean }) =>
		pi.sendMessage({ customType: "background-job", content, display: true, details }, { triggerTurn: true, deliverAs: "followUp" });

	// Wakes the agent with output lines matching pattern, batched per second and capped per job
	const watcher = (job: Job, pattern: RegExp) => {
		let partial = "";
		let pending: string[] = [];
		let timer: NodeJS.Timeout | undefined;
		let wakes = 0;
		const flush = () => {
			timer = undefined;
			// Once the job has ended, its final message carries the log tail instead
			if (job.status !== "running") return;
			wakes++;
			const capped = wakes === MAX_WAKES ? `\n(Reached ${MAX_WAKES} wake-ups; further matches are ignored, use bg_status to check.)` : "";
			wake(`Background job ${job.id} output matched /${pattern.source}/ (still running):\n${pending.slice(-TAIL_LINES).join("\n")}${capped}`, {
				headline: `${job.id} matched /${pattern.source}/`,
				last: pending[pending.length - 1] ?? "",
				error: false,
			});
			pending = [];
		};
		return (data: Buffer) => {
			if (wakes >= MAX_WAKES) return;
			const lines = (partial + data.toString("utf8")).split(/\r?\n|\r/);
			partial = lines.pop() ?? "";
			const hits = lines.filter((line) => pattern.test(line));
			if (hits.length === 0) return;
			pending.push(...hits);
			timer ??= setTimeout(flush, WAKE_DEBOUNCE_MS);
		};
	};

	// One line per running job above the input, with its elapsed time and latest output
	let ui: ExtensionContext["ui"] | undefined;
	const running = () => [...jobs.values()].filter((job) => job.status === "running");
	// "full" (the default), "compact" without the output, or "off", set with "background": { "jobs": ... } in pi's settings.json
	const jobsLine = () => (pi.getSettings() as { background?: { jobs?: string } }).background?.jobs ?? "full";
	const showJobs = () => {
		if (!ui) return;
		if (jobsLine() === "off" || running().length === 0) return ui.setWidget("background-jobs", undefined);
		ui.setWidget("background-jobs", (tui, theme) => {
			const timer = setInterval(() => tui.requestRender(), 1000);
			return {
				dispose: () => clearInterval(timer),
				invalidate() {},
				render(width: number) {
					const live = running();
					const lines = live.slice(0, MAX_SHOWN_JOBS).map((job) => {
						const command = shownCommand(job.command);
						const text =
							theme.fg("accent", " ⏵ ") +
							theme.fg("toolTitle", `${job.id} ${command.length > 50 ? `${command.slice(0, 49)}…` : command}`) +
							theme.fg("dim", ` · ${elapsed(job)}${jobsLine() === "full" && job.lastLine ? ` · ${job.lastLine}` : ""}`);
						return truncateToWidth(text, width);
					});
					if (live.length > MAX_SHOWN_JOBS) lines.push(theme.fg("dim", `   and ${live.length - MAX_SHOWN_JOBS} more`));
					return lines;
				},
			};
		});
	};

	const find = (id: string): Job => {
		const job = jobs.get(id);
		if (!job) throw new Error(`No background job ${id}; known: ${[...jobs.keys()].join(", ") || "none"}`);
		return job;
	};

	// Compact, Claude-Code-style rows instead of pi's default boxed tool and message rendering
	pi.registerMessageRenderer("background-job", (message, { expanded }, theme) => {
		const d = (message.details ?? {}) as { headline?: string; last?: string; error?: boolean };
		const head = theme.fg(d.error ? "error" : "success", "● ") + theme.fg("toolTitle", `Background ${d.headline ?? ""}`);
		const body = expanded ? String(message.content) : (d.last ?? "");
		return new Text(`${head}\n${theme.fg("dim", `  └ ${body.replace(/\n/g, "\n    ")}`)}`, 0, 0);
	});
	const row = (theme: any, text: string, context: any) => {
		const color = context.isError ? "error" : context.executionStarted && context.isPartial ? "accent" : "success";
		return new Text(theme.fg(color, "● ") + theme.fg("toolTitle", text), 0, 0);
	};
	const note = (theme: any, result: any, expanded: boolean) => {
		const text = result.content?.map((c: any) => c.text ?? "").join("\n") ?? "";
		// Collapsed: first sentence only ("Started bg1"), without the log path
		const short = text.split("\n")[0].split(";")[0];
		return new Text(theme.fg("dim", `  └ ${(expanded ? text : short).replace(/\n/g, "\n    ")}`), 0, 0);
	};

	pi.registerTool({
		name: "bg_run",
		label: "Background",
		description:
			"Start a shell command in the background and return immediately with a job id. Output goes to a log file. " +
			"When the command exits you automatically receive a message with its exit code and the last log lines, so do not poll or sleep waiting for it.",
		promptSnippet: "Run long shell commands (downloads, builds, long test suites) in the background",
		promptGuidelines: [
			"Use bg_run instead of bash for any command that may take longer than about 30 seconds, in particular: downloading large files, datasets, dumps or model weights; " +
				"installing heavy packages (torch, tensorflow, CUDA libraries, transformers, large requirement sets) or creating environments with them; cloning large repositories; " +
				"builds, compiles and docker builds; full test suites of non-trivial projects; training, evaluation, benchmark and data-processing scripts; and anything that sleeps, waits or polls.",
			"When unsure whether a command is quick, prefer bg_run: a quick job just reports back sooner, while a long bash command blocks the user until it finishes.",
			"After bg_run, continue with independent work or end your turn; a message with the exit code and log tail arrives automatically when the job exits, so never sleep, poll or tail the log to wait for it.",
			"Keep using bash for quick commands whose output you need right away, such as git, ls, cat, grep, find, file inspection and short checks.",
			"To react when a bg_run job prints something specific while it keeps running (a server is ready, an epoch finished, an error appeared), pass wake_on with a regex instead of polling.",
			"Don't redirect a bg_run command's output to a file (> file, 2>&1, nohup): bg_run already saves all of it to the job's log, and redirecting hides the job's progress from the user and from wake_on. If the output should be kept, tell the user where the job's log is.",
			"bg_run starts only after the other tool calls in the same reply have finished, so editing a file and starting a job that uses it in one reply is safe.",
			"Use bg_status to check progress of a bg_run job and bg_kill to stop one.",
			`bash commands time out after ${BASH_DEFAULT_TIMEOUT / 60} minutes unless you pass timeout (at most ${BASH_MAX_TIMEOUT / 60} minutes); run anything that may take longer with bg_run instead.`,
			"Unless the user explicitly asks for that bash command, never wait, poll or sleep in bash (while/until loops with sleep, watch, repeated status checks), not even as part of a larger command; start the wait with bg_run and pass wake_on to be woken when the awaited output appears.",
			"Unless the user explicitly asks otherwise, start long-running processes (training or evaluation runs, servers, watchers) with bg_run, not with & or nohup in bash followed by sleep; pass wake_on matching the lines you want to see, such as results or Traceback.",
		],
		// Runs after the edits in the same reply, so the job starts from the code pi just wrote
		executionMode: "sequential",
		renderShell: "self",
		renderCall: (args: any, theme, context) => row(theme, `Background $ ${String(args?.command ?? "").split("\n")[0]}`, context),
		renderResult: (result, { expanded }, theme) => note(theme, result, expanded),
		parameters: Type.Object({
			command: Type.String({ description: "Shell command to run" }),
			cwd: Type.Optional(Type.String({ description: "Working directory (defaults to the session cwd)" })),
			wake_on: Type.Optional(
				Type.String({
					description: "Regex; also wake you while the job runs whenever an output line matches, e.g. 'listening on|ready' or 'epoch \\d+'. Matches within a second are batched; at most 10 wake-ups per job.",
				}),
			),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const pattern = params.wake_on ? wakePattern(params.wake_on) : undefined;
			const id = `bg${next++}`;
			const dir = join(tmpdir(), "pi-bg");
			mkdirSync(dir, { recursive: true });
			const log = join(dir, `${process.pid}-${id}.log`);
			const out = createWriteStream(log);
			const job: Job = { id, command: params.command, log, started: Date.now(), controller: new AbortController(), status: "running" };
			jobs.set(id, job);

			const watch = pattern ? watcher(job, pattern) : undefined;
			const onData = (d: Buffer) => {
				out.write(d);
				watch?.(d);
				// Progress bars redraw with \r, so the last segment of either kind of line break is the current state
				const last = d.toString("utf8").replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").split(/\r\n|\r|\n/).map((line) => line.trim()).filter(Boolean).at(-1);
				if (last) job.lastLine = last;
			};

			// Output goes to a pipe, where Python would buffer prints until it exits; unbuffered, the latest line and wake_on stay live
			ops.exec(`export PYTHONUNBUFFERED=1; ${params.command}`, params.cwd ?? ctx.cwd, { onData, signal: job.controller.signal })
				.then(({ exitCode }) => {
					job.status = "exited";
					job.exitCode = exitCode;
				})
				.catch((err: Error) => {
					job.status = job.controller.signal.aborted ? "killed" : "failed";
					out.write(`\n[bg] ${err.message}\n`);
				})
				.finally(() => {
					job.ended = Date.now();
					showJobs();
					out.end(() => {
						// A kill from session shutdown has no session left to notify
						if (job.status === "killed" && !jobs.has(id)) return;
						wake(`Background job finished: ${summary(job)}\nLast lines:\n${tail(log, TAIL_LINES)}`, {
							headline: `${id} ${job.status === "exited" ? `exited ${job.exitCode}` : job.status} · ${elapsed(job)}`,
							last: tail(log, 1),
							error: job.status !== "exited" || job.exitCode !== 0,
						});
					});
				});

			if (ctx.mode === "tui") ui = ctx.ui;
			showJobs();
			return { content: [{ type: "text", text: `Started ${id}; log: ${log}. You will be notified when it exits.` }], details: { id, log } };
		},
	});

	pi.registerTool({
		name: "bg_status",
		label: "Background status",
		description: "List background jobs, or show one job's state and the tail of its log.",
		renderShell: "self",
		renderCall: (args: any, theme, context) => row(theme, `Background status ${args?.id ?? "(all)"}`, context),
		renderResult: (result, { expanded }, theme) => note(theme, result, expanded),
		parameters: Type.Object({
			id: Type.Optional(Type.String({ description: "Job id such as bg1; omit to list all jobs" })),
			lines: Type.Optional(Type.Number({ description: `Log lines to show (default ${TAIL_LINES})` })),
		}),
		async execute(_toolCallId, params) {
			if (!params.id) {
				const text = [...jobs.values()].map(summary).join("\n") || "No background jobs.";
				return { content: [{ type: "text", text }], details: {} };
			}
			const job = find(params.id);
			return { content: [{ type: "text", text: `${summary(job)}\n${tail(job.log, params.lines ?? TAIL_LINES)}` }], details: {} };
		},
	});

	pi.registerTool({
		name: "bg_kill",
		label: "Background kill",
		description: "Stop a running background job and its child processes.",
		renderShell: "self",
		renderCall: (args: any, theme, context) => row(theme, `Background kill ${args?.id ?? ""}`, context),
		renderResult: (result, { expanded }, theme) => note(theme, result, expanded),
		parameters: Type.Object({ id: Type.String({ description: "Job id such as bg1" }) }),
		async execute(_toolCallId, params) {
			const job = find(params.id);
			if (job.status !== "running") return { content: [{ type: "text", text: `${job.id} already ${job.status}` }], details: {} };
			job.controller.abort();
			return { content: [{ type: "text", text: `Stopping ${job.id}` }], details: {} };
		},
	});

	pi.on("session_shutdown", async () => {
		for (const job of jobs.values()) {
			if (job.status === "running") job.controller.abort();
		}
		jobs.clear();
	});
}
