import { createWriteStream, mkdirSync, readFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { createLocalBashOperations, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, stripTerminalSequences, Text, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { Type } from "typebox";

const TAIL_LINES = 20;
const TAIL_BYTES = 64 * 1024;
const BASH_DEFAULT_TIMEOUT = 120;
const BASH_MAX_TIMEOUT = 600;
const WAKE_DEBOUNCE_MS = 1000;
const MAX_WAKES = 10;
const MAX_SHOWN_JOBS = 3;
// How long finished results wait for jobs started alongside them before Pi is woken anyway
const GROUP_HOLD_MS = 2 * 60_000;

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
	// The turn that started the job; jobs from the same turn are reported together
	group: number;
	// Started with wake_on, so it may run indefinitely and doesn't hold back the others
	watched: boolean;
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

function state(job: Job): string {
	return job.status === "exited" ? `exit ${job.exitCode}` : job.status;
}

function summary(job: Job): string {
	return `${job.id} [${state(job)}, ${elapsed(job)}] ${job.command}\n  log: ${job.log}`;
}

/** An output line as a terminal would last have shown it: without escape codes or control characters, and a progress bar redrawn with \r in its latest state only. */
function cleanLine(line: string): string {
	const shown = stripTerminalSequences(line).split("\r").filter((part) => part.trim()).at(-1) ?? "";
	return shown.replace(/\t/g, "  ").replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "").trimEnd();
}

/** The part of a command worth showing: its first line, without a leading cd, with a script path shortened to its name and at most 50 characters. */
function shownCommand(command: string): string {
	const shown = command
		.split("\n")[0]
		.replace(/^\s*(cd\s+("[^"]*"|'[^']*'|\S+)\s*(&&|;)\s*)+/, "")
		.replace(/^\S*\/(?=[^\s/]+(\s|$))/, "");
	return shown.length > 50 ? `${shown.slice(0, 49)}…` : shown;
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

	const wake = (content: string, details: { headline: string; last: string; error: boolean }, triggerTurn = true) =>
		pi.sendMessage({ customType: "background-job", content, display: true, details }, { triggerTurn, deliverAs: "followUp" });

	// Jobs started in the same turn usually belong together, like several benchmarks to compare. While some of them
	// still run, a successful one's result is added to the conversation without waking Pi, so it answers once at the
	// end instead of after each job. A job that runs on too long doesn't hold the others back for more than GROUP_HOLD_MS.
	let turn = 0;
	pi.on("turn_start", async () => {
		turn++;
	});
	const holds = new Map<number, NodeJS.Timeout>();
	const runningInGroup = (job: Job) =>
		[...jobs.values()].filter((other) => other !== job && other.group === job.group && other.status === "running" && !other.watched);
	const report = (job: Job, content: string, details: { headline: string; last: string; error: boolean }) => {
		const others = job.watched ? [] : runningInGroup(job);
		// A failure wakes Pi straight away, so it can react before the rest of the group finishes
		if (others.length === 0 || details.error) {
			clearTimeout(holds.get(job.group));
			holds.delete(job.group);
			return wake(content, details);
		}
		wake(`${content}\n(Still running from the same turn: ${others.map((other) => other.id).join(", ")}; you'll be woken when they finish.)`, details, false);
		if (holds.has(job.group)) return;
		holds.set(job.group, setTimeout(() => {
			holds.delete(job.group);
			const still = runningInGroup(job);
			if (still.length === 0) return;
			wake(`Background jobs from the same turn are still running after ${GROUP_HOLD_MS / 60_000} minutes: ${still.map((other) => other.id).join(", ")}. The results of the ones that finished are above; you'll get a message when each of these finishes.`, {
				headline: `${still.map((other) => other.id).join(", ")} still running`,
				last: "",
				error: false,
			});
		}, GROUP_HOLD_MS));
	};

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
	const running = () => [...jobs.values()].filter((job) => job.status === "running");
	// The job open in /bg, left out of the jobs line meanwhile so it isn't shown twice
	let viewing: Job | undefined;
	// "full" (the default), "compact" without the output, or "off", set with "background": { "jobs": ... } in pi's settings.json
	const jobsLine = () => (pi.getSettings() as { background?: { jobs?: string } }).background?.jobs ?? "full";
	// The widget is set once per session and redrawn in place: setting it again would move it below the widgets other
	// extensions added since, while running jobs belong at the top, next to what Pi is doing now
	let redrawJobs = () => {};
	let ticker: NodeJS.Timeout | undefined;
	const showJobs = () => {
		// A running job's elapsed time and latest output change every second
		if (running().length > 0) ticker ??= setInterval(() => redrawJobs(), 1000);
		else {
			clearInterval(ticker);
			ticker = undefined;
		}
		redrawJobs();
	};
	const jobsWidget = (theme: any) => ({
		invalidate() {},
		render(width: number) {
			if (jobsLine() === "off") return [];
			const live = running().filter((job) => job !== viewing);
			const lines = live.slice(0, MAX_SHOWN_JOBS).map((job) => {
				const text =
					theme.fg("accent", "⏵ ") +
					theme.fg("toolTitle", `${job.id} ${shownCommand(job.command)}`) +
					theme.fg("dim", ` · ${elapsed(job)}${jobsLine() === "full" && job.lastLine ? ` · ${job.lastLine}` : ""}`);
				return truncateToWidth(text, width);
			});
			if (live.length > MAX_SHOWN_JOBS) lines.push(theme.fg("dim", `  and ${live.length - MAX_SHOWN_JOBS} more`));
			return lines;
		},
	});

	const find = (id: string): Job => {
		const job = jobs.get(id);
		if (!job) throw new Error(`No background job ${id}; known: ${[...jobs.keys()].join(", ") || "none"}`);
		return job;
	};

	// Compact, Claude-Code-style rows instead of pi's default boxed tool and message rendering: quiet grey once done,
	// with a dot only while running or when something failed
	pi.registerMessageRenderer("background-job", (message, { expanded }, theme) => {
		const d = (message.details ?? {}) as { headline?: string; last?: string; error?: boolean };
		const title = `Background ${d.headline ?? ""}`;
		const head = d.error ? theme.fg("error", "● ") + theme.fg("toolTitle", title) : `  ${theme.fg("dim", title)}`;
		const body = expanded ? String(message.content) : (d.last ?? "");
		return new Text(`${head}\n${theme.fg("dim", `  └ ${body.replace(/\n/g, "\n    ")}`)}`, 0, 0);
	});
	const row = (theme: any, text: string, context: any) => {
		const color = context.isError ? "error" : context.executionStarted && context.isPartial ? "accent" : undefined;
		return new Text(color ? theme.fg(color, "● ") + theme.fg("toolTitle", text) : `  ${theme.fg("dim", text)}`, 0, 0);
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
			"Pass wake_on only when you must act before a bg_run job ends, such as a server becoming ready to test against, or when the user asked to follow its progress. To report a job's result, leave wake_on out: the exit message already brings the exit code and last lines, so waking on every epoch or step only adds turns.",
			"Don't redirect a bg_run command's output to a file (> file, 2>&1, nohup): bg_run already saves all of it to the job's log, and redirecting hides the job's progress from the user and from wake_on. If the output should be kept, tell the user where the job's log is.",
			"bg_run starts only after the other tool calls in the same reply have finished, so editing a file and starting a job that uses it in one reply is safe.",
			"Use bg_status to check progress of a bg_run job and bg_kill to stop one.",
			`bash commands time out after ${BASH_DEFAULT_TIMEOUT / 60} minutes unless you pass timeout (at most ${BASH_MAX_TIMEOUT / 60} minutes); run anything that may take longer with bg_run instead.`,
			"Unless the user explicitly asks for that bash command, never wait, poll or sleep in bash (while/until loops with sleep, watch, repeated status checks), not even as part of a larger command; start the wait with bg_run and pass wake_on to be woken when the awaited output appears.",
			"Unless the user explicitly asks otherwise, start long-running processes (training or evaluation runs, servers, watchers) with bg_run, not with & or nohup in bash followed by sleep.",
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
					description: "Regex; also wake you while the job runs whenever an output line matches, e.g. 'listening on|ready'. Matches within a second are batched; at most 10 wake-ups per job.",
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
			const job: Job = { id, command: params.command, log, started: Date.now(), controller: new AbortController(), status: "running", group: turn, watched: Boolean(pattern) };
			jobs.set(id, job);

			const watch = pattern ? watcher(job, pattern) : undefined;
			const onData = (d: Buffer) => {
				out.write(d);
				watch?.(d);
				const last = d.toString("utf8").split("\n").map(cleanLine).filter((line) => line.trim()).at(-1)?.trim();
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
						report(job, `Background job finished: ${summary(job)}\nLast lines:\n${tail(log, TAIL_LINES)}`, {
							headline: `${id} ${job.status === "exited" ? `exited ${job.exitCode}` : job.status} · ${elapsed(job)}`,
							last: tail(log, 1),
							error: job.status !== "exited" || job.exitCode !== 0,
						});
					});
				});

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

	// Shows a job's latest output in place of the input until esc, refreshed every second while it runs
	pi.registerCommand("bg", {
		description: "Show a background job's latest output",
		getArgumentCompletions: (prefix) => {
			const matching = [...jobs.values()].filter((job) => job.id.startsWith(prefix.trim().toLowerCase()));
			return matching.length ? matching.map((job) => ({ value: job.id, label: job.id, description: `${shownCommand(job.command)} · ${state(job)}` })) : null;
		},
		handler: async (args, ctx) => {
			if (!ctx.hasUI) return;
			const all = [...jobs.values()].reverse();
			if (all.length === 0) return ctx.ui.notify("No background jobs yet", "info");
			// "/bg 2" works as well as "/bg bg2"
			const wanted = args.trim().toLowerCase().replace(/^(\d+)$/, "bg$1");
			let job = wanted ? jobs.get(wanted) : all.length === 1 ? all[0] : undefined;
			if (wanted && !job) return ctx.ui.notify(`No background job ${args.trim()}; there's ${[...jobs.keys()].join(", ")}`, "warning");
			if (!job) {
				// Matched by position, since the elapsed time in a label changes while the list is open
				const options = all.map((other) => `${other.id} ${shownCommand(other.command)} · ${state(other)} · ${elapsed(other)}`);
				job = all[options.indexOf((await ctx.ui.select("Background jobs", options)) ?? "")];
				if (!job) return;
			}
			const shown = job;
			viewing = shown;
			const log = shown.log.replace(homedir(), "~");
			try {
				await ctx.ui.custom<void>((tui, theme, _kb, done) => {
					const timer = setInterval(() => tui.requestRender(), 1000);
					return {
						dispose: () => clearInterval(timer),
						invalidate() {},
						handleInput: (data: string) => {
							if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c")) || data === "q") done();
						},
						render(width: number) {
							const color = shown.status === "running" ? "accent" : shown.status === "exited" && shown.exitCode === 0 ? "success" : "error";
							const title = theme.fg(color, " ● ") + theme.fg("toolTitle", `${shown.id} ${shownCommand(shown.command)}`);
							const status = theme.fg("muted", `${state(shown)} · ${elapsed(shown)} `);
							const gap = Math.max(1, width - visibleWidth(title) - visibleWidth(status));
							// At most half the terminal, so the conversation above stays in view
							const text = tail(shown.log, Math.max(3, Math.min(TAIL_LINES, Math.floor(tui.terminal.rows / 2))));
							const output = text === "(no output)" ? [theme.fg("dim", theme.italic("   no output yet"))] : text.split("\n").map((line) => `   ${cleanLine(line)}`);
							return [
								theme.fg("borderMuted", "─".repeat(width)),
								title + " ".repeat(gap) + status,
								...output,
								theme.fg("dim", ` esc to close · ${log}`),
								theme.fg("borderMuted", "─".repeat(width)),
							].map((line) => truncateToWidth(line, width));
						},
					};
				});
			} finally {
				viewing = undefined;
			}
		},
	});

	// After /reload or a resume, carry on after the ids already in the conversation so "bg3" keeps meaning one job
	pi.on("session_start", async (_event, ctx) => {
		if (ctx.mode === "tui") {
			ctx.ui.setWidget("background-jobs", (tui, theme) => {
				redrawJobs = () => tui.requestRender();
				return jobsWidget(theme);
			});
		}
		for (const entry of ctx.sessionManager.getBranch()) {
			const msg = entry.type === "message" ? (entry.message as any) : undefined;
			const n = Number(/^bg(\d+)$/.exec(msg?.role === "toolResult" && msg.toolName === "bg_run" ? String(msg.details?.id) : "")?.[1]);
			if (n >= next) next = n + 1;
		}
	});

	pi.on("session_shutdown", async () => {
		clearInterval(ticker);
		for (const timer of holds.values()) clearTimeout(timer);
		holds.clear();
		for (const job of jobs.values()) {
			if (job.status === "running") job.controller.abort();
		}
		jobs.clear();
	});
}
