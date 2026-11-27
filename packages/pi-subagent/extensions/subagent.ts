import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { type ExtensionAPI, type ExtensionContext, getAgentDir, parseFrontmatter } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, type TuiMouseEvent, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { Type } from "typebox";

const TIMEOUT_MS = 60 * 60_000;

interface Agent {
	name: string;
	description?: string;
	model?: string;
	prompt: string;
}

interface Run {
	label: string;
	started: number;
	controller: AbortController;
	/** What the agent did so far, a line per tool call or reply */
	activity: string[];
	/** Closes its view when it's open */
	close?: () => void;
}

// Each agent is a markdown file in ~/.pi/agent/agents: the body is its prompt and the frontmatter can set a description and model
function agents(): Agent[] {
	const dir = join(getAgentDir(), "agents");
	let files: string[];
	try {
		files = readdirSync(dir).filter((file) => file.endsWith(".md"));
	} catch {
		return [];
	}
	return files.map((file) => {
		const { frontmatter, body } = parseFrontmatter<{ description?: string; model?: string }>(readFileSync(join(dir, file), "utf8"));
		return { name: basename(file, ".md"), description: frontmatter.description, model: frontmatter.model, prompt: body.trim() };
	});
}

// Arguments go where the prompt says $ARGUMENTS, or after it
const fill = (prompt: string, args: string) =>
	prompt.includes("$ARGUMENTS") ? prompt.replaceAll("$ARGUMENTS", args) : args ? `${prompt}\n\n${args}` : prompt;

// A tool call as one line: the command, path or pattern it was given
const call = (name: string, args: any) => {
	const main = args?.command ?? args?.path ?? args?.pattern ?? args?.query ?? args?.url;
	const text = (typeof main === "string" ? main : JSON.stringify(args ?? {})).replace(/\s+/g, " ");
	return name === "bash" ? `$ ${text}` : `${name} ${text}`;
};

const elapsed = (run: Run) => {
	const s = Math.round((Date.now() - run.started) / 1000);
	return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export default function (pi: ExtensionAPI) {
	const runs = new Set<Run>();
	let redraw = () => {};
	let ticker: ReturnType<typeof setInterval> | undefined;

	// Running agents get a line each above the input, like pi-background's jobs
	pi.on("session_start", (_event, ctx) => {
		if (!ctx.hasUI) return;
		ctx.ui.setWidget("subagents", (tui, theme) => {
			redraw = () => tui.requestRender();
			return {
				invalidate() {},
				// Clicking an agent's line shows what it's doing
				handleMouse(event: TuiMouseEvent) {
					const run = listed()[event.y];
					if (event.type !== "click" || event.button !== "left" || !run) return undefined;
					void show(run, ctx);
					return { handled: true };
				},
				render: (width: number) =>
					listed().map((run) => truncateToWidth(theme.fg("accent", "⏵ ") + theme.fg("toolTitle", run.label) + theme.fg("dim", ` · ${elapsed(run)}`), width)),
			};
		});
	});
	// The agent open in its view is left out, so it isn't shown twice
	const listed = () => [...runs].filter((run) => !run.close);
	const changed = () => {
		if (runs.size && !ticker) ticker = setInterval(redraw, 1000);
		if (!runs.size) ticker = (clearInterval(ticker), undefined);
		redraw();
	};

	// An agent's latest activity in place of the input, until esc, a click on its title or the agent finishing
	const show = (run: Run, ctx: ExtensionContext) =>
		ctx.ui.custom<void>((tui, theme, _kb, done) => {
			run.close = done;
			const timer = setInterval(() => tui.requestRender(), 1000);
			return {
				dispose: () => {
					clearInterval(timer);
					run.close = undefined;
				},
				invalidate() {},
				handleInput: (data: string) => {
					if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c")) || data === "q") done();
				},
				handleMouse: (event: TuiMouseEvent) => {
					if (event.type !== "click" || event.button !== "left" || event.y !== 1) return undefined;
					done();
					return { handled: true };
				},
				render(width: number) {
					const title = theme.fg("accent", " ● ") + theme.fg("toolTitle", run.label);
					const status = theme.fg("muted", `running · ${elapsed(run)} `);
					// At most half the terminal, so the conversation above stays in view
					const shown = run.activity.slice(-Math.max(3, Math.floor(tui.terminal.rows / 2)));
					return [
						theme.fg("borderMuted", "─".repeat(width)),
						title + " ".repeat(Math.max(1, width - visibleWidth(title) - visibleWidth(status))) + status,
						...(shown.length ? shown.map((line) => `   ${line}`) : [theme.fg("dim", theme.italic("   starting…"))]),
						theme.fg("dim", " esc to close"),
						theme.fg("borderMuted", "─".repeat(width)),
					].map((line) => truncateToWidth(line, width));
				},
			};
		});

	// A fresh Pi, the same one that's running, without this conversation. Its session is saved, so you can open it
	// afterwards and carry on there. Its JSON events show what it's doing meanwhile, and its last reply is the report
	async function run(ctx: ExtensionContext, label: string, prompt: string, model: string | undefined, signal?: AbortSignal) {
		const id = randomUUID();
		const entry: Run = { label, started: Date.now(), controller: new AbortController(), activity: [] };
		signal?.addEventListener("abort", () => entry.controller.abort());
		runs.add(entry);
		changed();
		try {
			const args = ["--mode", "json", "--session-id", id, "--name", `agent: ${label}`, ...(model ? ["--model", model] : []), prompt];
			const child = spawn(process.execPath, [process.argv[1], ...args], { cwd: ctx.cwd, signal: entry.controller.signal, timeout: TIMEOUT_MS, stdio: ["ignore", "pipe", "pipe"] });
			let report = "";
			let error = "";
			let stderr = "";
			let pending = "";
			child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
				const lines = (pending + chunk).split("\n");
				pending = lines.pop()!;
				for (const line of lines) {
					let event: any;
					try {
						event = JSON.parse(line);
					} catch {
						continue;
					}
					if (event.type === "tool_execution_start") entry.activity.push(call(event.toolName, event.args));
					if (event.type === "message_end" && event.message?.role === "assistant") {
						const text = (event.message.content ?? []).filter((part: any) => part.type === "text").map((part: any) => part.text).join("\n").trim();
						if (text) entry.activity.push(text.split("\n")[0]);
						report = text || report;
						error = event.message.stopReason === "error" ? (event.message.errorMessage ?? "error") : "";
					}
				}
			});
			child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
			const code = await new Promise<number | null>((resolve) => child.on("close", resolve).on("error", () => resolve(null)));
			const text =
				code === 0 && report && !error
					? report
					: `The agent failed (exit ${code}${entry.controller.signal.aborted ? ", stopped" : ""}): ${(error || stderr || report).trim().slice(-800)}`;
			return { id, text };
		} finally {
			runs.delete(entry);
			entry.close?.();
			changed();
		}
	}

	pi.registerCommand("agent", {
		description: "Run an agent from ~/.pi/agent/agents, or any prompt, in the background: /agent <name> [arguments] or /agent <prompt>",
		getArgumentCompletions: (prefix) => {
			const matches = agents().filter((agent) => agent.name.startsWith(prefix.trim()));
			return matches.length ? matches.map((agent) => ({ value: agent.name, label: agent.name, description: agent.description })) : null;
		},
		handler: async (args, ctx) => {
			const [first = "", ...rest] = args.trim().split(/\s+/);
			if (!first) {
				const list = agents().map((agent) => `${agent.name}${agent.description ? ` · ${agent.description}` : ""}`);
				return ctx.ui.notify(list.length ? `Agents:\n${list.join("\n")}` : `No agents yet: add a markdown file to ${join(getAgentDir(), "agents")}`, "info");
			}
			const agent = agents().find((agent) => agent.name === first);
			const current = ctx.model && `${ctx.model.provider}/${ctx.model.id}`;
			const label = agent ? args.trim() : args.trim().replace(/\s+/g, " ").slice(0, 60);
			const prompt = agent ? fill(agent.prompt, rest.join(" ")) : args.trim();
			void run(ctx, label, prompt, agent?.model ?? current).then(({ id, text }) =>
				pi.sendMessage(
					{ customType: "subagent", display: true, content: `Agent ${label} finished:\n\n${text}\n\n(open its session with pi --session ${id})`, details: { id } },
					{ deliverAs: "steer" },
				),
			);
		},
	});

	// Prompt templates can hand work to agents with this tool. It's off unless a command or prompt template started
	// the run, so Pi never starts agents on its own
	const setTool = (on: boolean) => {
		const active = pi.getActiveTools().filter((name) => name !== "agent");
		pi.setActiveTools(on ? [...active, "agent"] : active);
	};
	// Set when each run starts, so a template typed while Pi is busy doesn't hand the tool to the run already going
	let armed = false;
	pi.on("session_start", () => setTool(false));
	pi.on("input", (event) => {
		armed = event.source === "extension" || event.text.trimStart().startsWith("/");
		return { action: "continue" };
	});
	pi.on("before_agent_start", () => {
		setTool(armed);
		armed = false;
	});
	pi.on("agent_end", () => setTool(false));

	pi.registerTool({
		name: "agent",
		label: "Agent",
		description:
			"Run a prompt in a fresh Pi agent that starts without this conversation, optionally with another model, and return its final report. Give it everything it needs in the prompt. Several calls in one turn run at the same time.",
		promptSnippet: "Run a prompt in a fresh Pi agent and get its report",
		promptGuidelines: ["Use agent only as the command or prompt template you were given says to."],
		parameters: Type.Object({
			prompt: Type.String({ description: "The whole task, self-contained" }),
			model: Type.Optional(Type.String({ description: "provider/model, with an optional :thinking level; defaults to Pi's default model" })),
		}),
		async execute(_id, params, signal, _onUpdate, ctx) {
			const { id, text } = await run(ctx, params.prompt.replace(/\s+/g, " ").slice(0, 60), params.prompt, params.model, signal);
			return { content: [{ type: "text", text: `${text}\n\n(session: pi --session ${id})` }], details: { id } };
		},
	});

	pi.on("session_shutdown", () => {
		for (const run of runs) run.controller.abort();
		clearInterval(ticker);
	});
}
