import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { type ExtensionAPI, type ExtensionContext, getAgentDir, parseFrontmatter } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
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
				render: (width: number) =>
					[...runs].map((run) => truncateToWidth(theme.fg("accent", "⏵ ") + theme.fg("toolTitle", run.label) + theme.fg("dim", ` · ${elapsed(run)}`), width)),
			};
		});
	});
	const changed = () => {
		if (runs.size && !ticker) ticker = setInterval(redraw, 1000);
		if (!runs.size) ticker = (clearInterval(ticker), undefined);
		redraw();
	};

	// A fresh Pi, the same one that's running, without this conversation. Its session is saved, so you can open it afterwards and carry on there
	async function run(ctx: ExtensionContext, label: string, prompt: string, model: string | undefined, signal?: AbortSignal) {
		const id = randomUUID();
		const entry: Run = { label, started: Date.now(), controller: new AbortController() };
		signal?.addEventListener("abort", () => entry.controller.abort());
		runs.add(entry);
		changed();
		try {
			const args = ["-p", "--session-id", id, "--name", `agent: ${label}`, ...(model ? ["--model", model] : []), prompt];
			const result = await pi.exec(process.execPath, [process.argv[1], ...args], { cwd: ctx.cwd, signal: entry.controller.signal, timeout: TIMEOUT_MS });
			const report = result.stdout.trim();
			const text =
				result.code === 0 && report
					? report
					: `The agent failed (exit ${result.code}${result.killed ? ", stopped" : ""}): ${(result.stderr || result.stdout).trim().slice(-800)}`;
			return { id, text };
		} finally {
			runs.delete(entry);
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
