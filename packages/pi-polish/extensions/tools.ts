import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import {
	createBashToolDefinition,
	createEditToolDefinition,
	createFindToolDefinition,
	createGrepToolDefinition,
	createLsToolDefinition,
	createReadToolDefinition,
	createWriteToolDefinition,
	getLanguageFromPath,
	highlightCode,
	keyHint,
	type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { type Component, Container, Text, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import bash from "@shikijs/langs/shellscript";
import css from "@shikijs/langs/css";
import c from "@shikijs/langs/c";
import diff from "@shikijs/langs/diff";
import docker from "@shikijs/langs/docker";
import go from "@shikijs/langs/go";
import html from "@shikijs/langs/html";
import ini from "@shikijs/langs/ini";
import java from "@shikijs/langs/java";
import javascript from "@shikijs/langs/javascript";
import json from "@shikijs/langs/json";
import jsonc from "@shikijs/langs/jsonc";
import jsx from "@shikijs/langs/jsx";
import lua from "@shikijs/langs/lua";
import make from "@shikijs/langs/make";
import markdown from "@shikijs/langs/markdown";
import python from "@shikijs/langs/python";
import rust from "@shikijs/langs/rust";
import sql from "@shikijs/langs/sql";
import toml from "@shikijs/langs/toml";
import tsx from "@shikijs/langs/tsx";
import typescript from "@shikijs/langs/typescript";
import xml from "@shikijs/langs/xml";
import yaml from "@shikijs/langs/yaml";
import darkPlus from "@shikijs/themes/dark-plus";
import { diffWordsWithSpace } from "diff";
import { createHighlighterCoreSync, type HighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";

const MARK = "●";

// Some models default to shell heredocs and sed even with pi's built-in guidance; these make the file tools the default
const FILE_TOOL_GUIDELINES: Record<string, string[]> = {
	read: ["Use read to view file contents instead of cat, head, tail or sed -n in bash."],
	edit: [
		"Use edit to change existing files instead of bash: never modify files with sed -i, perl -pi, python or node scripts, or shell redirection.",
	],
	write: [
		"Use write to create new files or fully rewrite small ones instead of bash: never create files with cat <<EOF, echo or printf redirection, tee, or python scripts.",
		"write creates missing parent directories itself, so call it directly instead of combining mkdir -p with a heredoc in bash.",
	],
};

function withGuidelines<T extends { promptGuidelines?: string[] }>(name: string, def: T): T {
	return { ...def, promptGuidelines: [...(def.promptGuidelines ?? []), ...(FILE_TOOL_GUIDELINES[name] ?? [])] };
}

const DIFF_PREVIEW_LINES = 16;
const ADDED_BG = "\x1b[48;2;13;46;16m";
const REMOVED_BG = "\x1b[48;2;63;12;16m";
const BG_RESET = "\x1b[49m";
// Brighter bands for the words that changed within a replaced line
const ADDED_WORD_BG = "\x1b[48;2;31;95;38m";
const REMOVED_WORD_BG = "\x1b[48;2;122;30;36m";
// Line numbers and +/- signs tinted to match their band, like Claude Code, instead of dim gray
const ADDED_GUTTER = "\x1b[38;2;120;200;120m";
const REMOVED_GUTTER = "\x1b[38;2;230;120;120m";
const FG_RESET = "\x1b[39m";

type Kind = "bash" | "read" | "search" | "list";
const KIND_OF: Record<string, Kind> = { bash: "bash", read: "read", grep: "search", find: "search", ls: "list" };
const VERBS: Record<Kind, [done: string, running: string, one: string, many: string]> = {
	bash: ["Ran", "Running", "shell command", "shell commands"],
	read: ["Read", "Reading", "file", "files"],
	search: ["Searched", "Searching", "pattern", "patterns"],
	list: ["Listed", "Listing", "directory", "directories"],
};

interface Member {
	id: string;
	kind: Kind;
	label: string;
	done: boolean;
	error: boolean;
}

interface Group {
	members: Member[];
	started: number;
	ended?: number;
	timer?: NodeJS.Timeout;
}

type Result = { content: Array<{ type: string; text?: string }>; details?: unknown };

function resultText(result: Result): string {
	return result.content
		.filter((c) => c.type === "text")
		.map((c) => c.text ?? "")
		.join("\n");
}

function shortPath(path: unknown, cwd: string): string {
	const p = String(path ?? "?");
	const rel = relative(cwd, p);
	return rel && !rel.startsWith("..") && !rel.startsWith("/") ? rel : p;
}

function label(toolName: string, args: any, cwd: string): string {
	switch (toolName) {
		case "bash":
			return `$ ${String(args?.command ?? "").split("\n")[0]}`;
		case "read":
			return `Read ${shortPath(args?.path, cwd)}`;
		case "grep":
			return `Search "${args?.pattern ?? ""}"${args?.path ? ` in ${shortPath(args.path, cwd)}` : ""}`;
		case "find":
			return `Find "${args?.pattern ?? ""}"${args?.path ? ` in ${shortPath(args.path, cwd)}` : ""}`;
		default:
			return `List ${args?.path ? shortPath(args.path, cwd) : "."}`;
	}
}

function summary(group: Group, running: boolean): string {
	const counts = new Map<Kind, number>();
	for (const m of group.members) counts.set(m.kind, (counts.get(m.kind) ?? 0) + 1);
	const parts = [...counts].map(([kind, n]) => {
		const [done, active, one, many] = VERBS[kind];
		return `${(running ? active : done).toLowerCase()} ${n} ${n === 1 ? one : many}`;
	});
	const text = parts.join(", ");
	return text.charAt(0).toUpperCase() + text.slice(1);
}

function expandedBody(theme: any, text: string, maxLines = 60): string {
	const lines = text.split("\n");
	const shown = lines.slice(0, maxLines).join("\n");
	const extra = lines.length > maxLines ? `\n${theme.fg("dim", `... ${lines.length - maxLines} more lines`)}` : "";
	return "  " + theme.fg("toolOutput", shown).replace(/\n/g, "\n  ") + extra;
}

// Shiki (TextMate grammars, as in VS Code) with Dark+ to match Neovim's vscode.nvim. Dark+ leaves Python calls and
// attributes uncolored because VS Code gets those from Pylance; these rules color them like tree-sitter does.
// C++ is left out: its grammar takes ~0.5s to compile on first use and would freeze the screen; pi's highlighter covers it.
const SHIKI_LANGS = [bash, css, c, diff, docker, go, html, ini, java, javascript, json, jsonc, jsx, lua, make, markdown, python, rust, sql, toml, tsx, typescript, xml, yaml];
const EXT_TO_LANG: Record<string, string> = {
	sh: "shellscript", bash: "shellscript", zsh: "shellscript", css: "css", c: "c", h: "c", diff: "diff", patch: "diff",
	go: "go", html: "html", htm: "html", ini: "ini", cfg: "ini", conf: "ini", java: "java", js: "javascript",
	mjs: "javascript", cjs: "javascript", json: "json", jsonc: "jsonc", jsx: "jsx", lua: "lua", mk: "make",
	md: "markdown", py: "python", pyi: "python", rs: "rust", sql: "sql", toml: "toml", tsx: "tsx", ts: "typescript",
	mts: "typescript", cts: "typescript", xml: "xml", yml: "yaml", yaml: "yaml",
};
const FILE_TO_LANG: Record<string, string> = { Dockerfile: "docker", Makefile: "make", makefile: "make" };
const SHIKI_THEME = {
	...darkPlus,
	name: "dark-plus-pi",
	tokenColors: [
		...(darkPlus as any).tokenColors,
		{ scope: ["meta.function-call.generic"], settings: { foreground: "#DCDCAA" } },
		{ scope: ["meta.attribute"], settings: { foreground: "#9CDCFE" } },
	],
};
let shiki: HighlighterCore | undefined;

/** Slightly brighter and more saturated than stock Dark+, which reads as muddy on the terminal background. */
function brighten(hex: string): [number, number, number] {
	// Plain code text is Dark+'s gray foreground; saturation can't lift a gray, so it maps straight to near-white
	if (hex.toUpperCase().startsWith("#D4D4D4")) return [238, 238, 238];
	const n = Number.parseInt(hex.slice(1, 7), 16);
	let [r, g, b] = [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	let h = 0;
	let s = 0;
	let l = (max + min) / 2;
	if (max !== min) {
		const d = max - min;
		s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
		h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
		h /= 6;
	}
	s = Math.min(1, s * 1.4);
	// Lightening an already light color (function yellow, variable blue) washes it out to near-white, so only darker ones get it
	if (l < 0.65) l = Math.min(0.72, l * 1.12);
	const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
	const p = 2 * l - q;
	const hue = (t: number) => {
		const x = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
		return x < 1 / 6 ? p + (q - p) * 6 * x : x < 1 / 2 ? q : x < 2 / 3 ? p + (q - p) * (2 / 3 - x) * 6 : p;
	};
	[r, g, b] = s === 0 ? [l, l, l] : [hue(h + 1 / 3), hue(h), hue(h - 1 / 3)];
	return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

const DEFAULT_FG = "#D4D4D4";
const TYPE_FG = "#4EC9B0";
const VARIABLE_FG = "#9CDCFE";
const PY_BUILTIN_TYPES = new Set(["bool", "bytearray", "bytes", "complex", "dict", "float", "frozenset", "int", "list", "object", "set", "str", "tuple", "type"]);

/** Imported module names and aliases, from the snippet and the file on disk, so they can be colored as modules. */
function pythonModules(code: string, path: string): Set<string> {
	let source = code;
	try {
		source += `\n${readFileSync(resolve(path), "utf8")}`;
	} catch {}
	const names = new Set<string>();
	for (const m of source.matchAll(/^\s*import\s+([\w., ]+)/gm)) {
		for (const item of m[1].split(",")) {
			const [mod, alias] = item.trim().split(/\s+as\s+/);
			if (mod) names.add(alias ?? mod.split(".")[0]);
		}
	}
	for (const m of source.matchAll(/^\s*from\s+([\w.]+)\s+import/gm)) names.add(m[1].split(".")[0]);
	return names;
}

/** Highlights code with Shiki when the file type is covered; undefined lets pi's own highlighter take over. */
function shikiLines(code: string, path: string): string[] | undefined {
	const name = path.split("/").pop() ?? "";
	const lang = FILE_TO_LANG[name] ?? EXT_TO_LANG[name.split(".").pop()?.toLowerCase() ?? ""];
	if (!lang) return undefined;
	try {
		shiki ??= createHighlighterCoreSync({ themes: [SHIKI_THEME as any], langs: SHIKI_LANGS, engine: createJavaScriptRegexEngine() });
		const modules = lang === "python" ? pythonModules(code, path) : undefined;
		const paint = (hex: string, text: string, italic = false) => {
			const [r, g, b] = brighten(hex);
			return `\x1b[38;2;${r};${g};${b}m${italic ? "\x1b[3m" : ""}${text}${italic ? "\x1b[23m" : ""}\x1b[39m`;
		};
		return shiki.codeToTokensBase(code, { lang, theme: "dark-plus-pi" }).map((line) =>
			line
				.map((t) => {
					const color = t.color ?? DEFAULT_FG;
					// Python names the grammar leaves unscoped: color them like Neovim's tree-sitter + LSP does
					if (modules && color.toUpperCase().startsWith(DEFAULT_FG)) {
						return t.content.replace(/[A-Za-z_]\w*|[^A-Za-z_]+/g, (part) => {
							if (!/^[A-Za-z_]/.test(part)) return paint(DEFAULT_FG, part);
							if (modules.has(part) || PY_BUILTIN_TYPES.has(part)) return paint(TYPE_FG, part);
							return paint(VARIABLE_FG, part);
						});
					}
					return paint(color, t.content, Boolean((t.fontStyle ?? 0) & 1));
				})
				.join(""),
		);
	} catch {
		return undefined;
	}
}

type Span = [number, number];

/**
 * The changed words of a replaced line, as column spans on each side (jsdiff word diff). Changes separated only by
 * whitespace merge into one span. Undefined when the lines share too little for word highlighting to mean anything.
 */
function changedSpans(before: string, after: string): [Span[], Span[]] | undefined {
	const removed: Span[] = [];
	const added: Span[] = [];
	let [b, a, same] = [0, 0, 0];
	const push = (spans: Span[], start: number, end: number) => {
		const last = spans[spans.length - 1];
		if (last && /^\s*$/.test((spans === removed ? before : after).slice(last[1], start))) last[1] = end;
		else spans.push([start, end]);
	};
	for (const part of diffWordsWithSpace(before, after)) {
		const n = part.value.length;
		if (part.removed) push(removed, b, (b += n));
		else if (part.added) push(added, a, (a += n));
		else {
			b += n;
			a += n;
			same += part.value.trim().length;
		}
	}
	if (same < 0.3 * Math.max(before.trim().length, after.trim().length)) return undefined;
	return [removed, added];
}

/** Puts a background on the given visible column spans of an ANSI-colored line, surviving color resets inside them. */
function withBackground(line: string, spans: Span[], on: string, off: string): string {
	const marked = (col: number) => spans.some(([start, end]) => col >= start && col < end);
	let out = "";
	let col = 0;
	let inside = false;
	for (let i = 0; i < line.length; ) {
		const esc = /^\x1b\[[0-9;]*m/.exec(line.slice(i));
		if (esc) {
			out += esc[0] + (inside && /^\x1b\[0?m$/.test(esc[0]) ? on : "");
			i += esc[0].length;
			continue;
		}
		const want = marked(col);
		if (want !== inside) {
			out += want ? on : off;
			inside = want;
		}
		out += line[i++];
		col++;
	}
	return inside ? out + off : out;
}

/**
 * Renders pi's "+12 text" / "-12 text" / " 12 text" diff lines with syntax highlighting, added and
 * removed lines as full-width colored bands.
 */
class DiffView implements Component {
	private highlighted: string[];

	constructor(
		private lines: string[],
		private theme: any,
		private footer?: string,
		path = "",
	) {
		// Highlight all bodies as one snippet so multi-line strings and docstrings color correctly
		const bodies = lines.map((line) => (/^[+\- ]\s*\d*\s(.*)$/.exec(line)?.[1] ?? line.slice(1)).replace(/\t/g, "    "));
		let highlighted: string[] = [];
		try {
			const code = bodies.join("\n");
			const lang = getLanguageFromPath(path);
			highlighted = shikiLines(code, path) ?? (lang ? highlightCode(code, lang) : []);
		} catch {
			highlighted = [];
		}
		this.highlighted = highlighted.length === bodies.length ? highlighted : bodies.map((b) => theme.fg("toolTitle", b));

		// Pair each run of removed lines with the added run right after it, line by line, and mark the changed words
		for (let i = 0; i < lines.length; ) {
			if (lines[i][0] !== "-") {
				i++;
				continue;
			}
			let removedEnd = i;
			while (removedEnd < lines.length && lines[removedEnd][0] === "-") removedEnd++;
			let addedEnd = removedEnd;
			while (addedEnd < lines.length && lines[addedEnd][0] === "+") addedEnd++;
			for (let k = 0; k < Math.min(removedEnd - i, addedEnd - removedEnd); k++) {
				const [r, a] = [i + k, removedEnd + k];
				const spans = changedSpans(bodies[r], bodies[a]);
				if (!spans) continue;
				this.highlighted[r] = withBackground(this.highlighted[r], spans[0], REMOVED_WORD_BG, REMOVED_BG);
				this.highlighted[a] = withBackground(this.highlighted[a], spans[1], ADDED_WORD_BG, ADDED_BG);
			}
			i = addedEnd;
		}
	}

	render(width: number): string[] {
		const out = this.lines.map((line, i) => {
			const sign = line[0];
			const num = /^[+\- ](\s*\d*)\s/.exec(line)?.[1] ?? "";
			const gutterText = `    ${num} ${sign === " " ? " " : sign} `;
			const gutter = sign === "+" ? ADDED_GUTTER + gutterText + FG_RESET : sign === "-" ? REMOVED_GUTTER + gutterText + FG_RESET : this.theme.fg("dim", gutterText);
			// Bands stop two columns short of the right edge, like Claude Code's
			const inner = Math.max(10, width - 2);
			const text = truncateToWidth(gutter + this.highlighted[i], inner);
			if (sign === " ") return text;
			const bg = sign === "+" ? ADDED_BG : REMOVED_BG;
			const pad = " ".repeat(Math.max(0, inner - visibleWidth(text)));
			// Highlighter resets would end the band early, so restore the background after each one
			return `${bg}${text.replace(/\x1b\[0?m/g, (m) => m + bg)}${pad}${BG_RESET}`;
		});
		if (this.footer) out.push(truncateToWidth(this.footer, width));
		return out;
	}

	invalidate(): void {}
}

function lineCount(n: number): string {
	return `${n} line${n === 1 ? "" : "s"}`;
}

function errorText(theme: any, text: string, expanded: boolean): Text {
	const lines = text.trim().split("\n");
	const body = expanded ? lines.join("\n    ") : lines[0] + (lines.length > 1 ? theme.fg("dim", `  (${keyHint("app.tools.expand", "details")})`) : "");
	return new Text(theme.fg("error", `  └ ${body}`), 0, 0);
}

function empty() {
	return new Container();
}

export default function (pi: ExtensionAPI) {
	const cwd = process.cwd();
	const groupOf = new Map<string, Group>();
	const rowInvalidate = new Map<string, () => void>();
	let current: Group | undefined;
	let live = false;
	// False until session_start has grouped the history; pi draws old rows before that event
	let ready = false;

	const refresh = (group: Group) => {
		for (const m of group.members) rowInvalidate.get(m.id)?.();
	};

	const tick = (group: Group) => {
		const running = group.members.some((m) => !m.done);
		if (running && !group.timer) group.timer = setInterval(() => rowInvalidate.get(group.members[0].id)?.(), 1000);
		if (!running && group.timer) {
			clearInterval(group.timer);
			group.timer = undefined;
			group.ended = Date.now();
		}
	};

	const assign = (id: string, toolName: string, args: unknown, done = false, error = false): Group => {
		current ??= { members: [], started: Date.now() };
		current.members.push({ id, kind: KIND_OF[toolName], label: label(toolName, args, cwd), done, error });
		groupOf.set(id, current);
		return current;
	};

	const reset = () => {
		for (const g of new Set(groupOf.values())) if (g.timer) clearInterval(g.timer);
		groupOf.clear();
		current = undefined;
		ready = false;
	};

	// Rebuild groups for history so resumed sessions collapse the same way
	pi.on("session_start", async (_event, ctx) => {
		reset();
		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type !== "message") continue;
			const msg = entry.message as any;
			if (msg.role === "user") current = undefined;
			if (msg.role !== "assistant") continue;
			for (const part of msg.content ?? []) {
				if (part.type === "text" && part.text.trim()) current = undefined;
				if (part.type !== "toolCall") continue;
				if (KIND_OF[part.name]) assign(part.id, part.name, part.arguments, true);
				else current = undefined;
			}
		}
		current = undefined;
		ready = true;
		for (const invalidate of rowInvalidate.values()) invalidate();
		// History rows were drawn before they were grouped; a full redraw clears their stale lines
		if (ctx.hasUI) {
			ctx.ui.setWidget("pi-polish-redraw", (tui) => {
				setTimeout(() => {
					ctx.ui.setWidget("pi-polish-redraw", undefined);
					tui.requestRender(true);
				}, 0);
				return new Container();
			});
		}
	});

	pi.on("agent_start", async () => {
		live = true;
		current = undefined;
	});
	pi.on("agent_end", async () => {
		live = false;
		current = undefined;
	});
	pi.on("message_end", async (event) => {
		const msg = event.message as any;
		if (msg.role === "assistant" && (msg.content ?? []).some((c: any) => c.type === "text" && c.text.trim())) current = undefined;
	});
	pi.on("tool_execution_start", async (event) => {
		if (!KIND_OF[event.toolName]) {
			current = undefined;
			return;
		}
		const group = assign(event.toolCallId, event.toolName, event.args);
		tick(group);
		refresh(group);
	});
	pi.on("tool_execution_end", async (event) => {
		const group = groupOf.get(event.toolCallId);
		const member = group?.members.find((m) => m.id === event.toolCallId);
		if (!group || !member) return;
		member.done = true;
		member.error = event.isError;
		tick(group);
		refresh(group);
	});
	pi.on("session_shutdown", async () => reset());

	/** Collapsed rendering for a grouped tool row; the group's first row draws the whole group. */
	const renderGrouped = (toolCallId: string, theme: any, context: any): Component | undefined => {
		rowInvalidate.set(toolCallId, context.invalidate);
		if (context.expanded) return undefined;
		const group = groupOf.get(toolCallId);
		// Live rows wait for tool_execution_start to place them; history rows without a group render alone
		if (!group) return live || !ready ? empty() : undefined;
		if (group.members[0].id !== toolCallId) return empty();

		const running = group.members.some((m) => !m.done);
		const failed = group.members.filter((m) => m.error).length;
		const failNote = failed ? theme.fg("error", ` · ${failed} failed`) : "";
		if (running) {
			const secs = Math.round((Date.now() - group.started) / 1000);
			const active = [...group.members].reverse().find((m) => !m.done) ?? group.members[group.members.length - 1];
			const head = theme.fg("accent", `${MARK} `) + theme.fg("toolTitle", `${summary(group, true)}…`) + theme.fg("dim", ` · ${secs}s`) + failNote;
			return new Text(`${head}\n${theme.fg("dim", `  └ ${active.label}`)}`, 0, 0);
		}
		const hint = theme.fg("dim", `  (${keyHint("app.tools.expand", "expand")})`);
		const mark = theme.fg(failed ? "error" : "success", `${MARK} `);
		const text = group.members.length === 1 ? group.members[0].label : summary(group, false);
		return new Text(mark + theme.fg("toolTitle", text) + failNote + hint, 0, 0);
	};

	// The ● carries the status, like Claude Code: dim while arguments stream, accent while running, green or red when done.
	// History rows redrawn after /reload have no execution state, so they count as done.
	const dot = (theme: any, context: { isPartial?: boolean; isError?: boolean; executionStarted?: boolean }) => {
		if (context.isError) return theme.fg("error", `${MARK} `);
		if (context.executionStarted && context.isPartial) return theme.fg("accent", `${MARK} `);
		if (!context.executionStarted && live) return theme.fg("dim", `${MARK} `);
		return theme.fg("success", `${MARK} `);
	};

	const groupedTool = (toolName: string, def: any) => {
		pi.registerTool({
			...def,
			renderShell: "self",
			renderCall(args: any, theme, context) {
				const grouped = renderGrouped(context.toolCallId, theme, context);
				if (grouped) return grouped;
				const text = truncateToWidth(label(toolName, args, cwd), 400);
				return new Text(dot(theme, context) + theme.fg("toolTitle", text), 0, 0);
			},
			renderResult(result, { expanded }, theme) {
				if (!expanded) return empty();
				return new Text(expandedBody(theme, resultText(result as Result)), 0, 0);
			},
		});
	};

	groupedTool("bash", createBashToolDefinition(cwd, {}));
	groupedTool("read", withGuidelines("read", createReadToolDefinition(cwd, {})));
	// pi leaves these off unless the user enables them, so registering them here must not switch them on
	groupedTool("grep", { ...createGrepToolDefinition(cwd, {}), defaultActive: false });
	groupedTool("find", { ...createFindToolDefinition(cwd, {}), defaultActive: false });
	groupedTool("ls", { ...createLsToolDefinition(cwd, {}), defaultActive: false });

	/** An edit or write row: "Update path" or "Write path", then a stats line and a diff preview. */
	const fileTool = (verb: string, def: any, diffOf: (result: any, args: any) => [stats: string, lines: string[]]) => {
		pi.registerTool({
			...def,
			renderShell: "self",
			renderCall(args: any, theme, context) {
				return new Text(dot(theme, context) + theme.fg("toolTitle", `${verb} ${shortPath(args?.path, cwd)}`), 0, 0);
			},
			renderResult(result, { expanded, isPartial }, theme, context) {
				if (isPartial) return empty();
				if (context.isError) return errorText(theme, resultText(result as Result), expanded);
				const args = context.args as any;
				const [stats, lines] = diffOf(result, args);
				const shown = expanded ? lines : lines.slice(0, DIFF_PREVIEW_LINES);
				const more = lines.length - shown.length;
				const footer = more > 0 ? theme.fg("dim", `    … +${more} lines (${keyHint("app.tools.expand", "expand")})`) : undefined;
				const box = new Container();
				box.addChild(new Text(theme.fg("dim", `  └ ${stats}`), 0, 0));
				box.addChild(new DiffView(shown, theme, footer, String(args?.path ?? "")));
				return box;
			},
		});
	};

	fileTool("Update", withGuidelines("edit", createEditToolDefinition(cwd, {})), (result) => {
		const diff = String(result.details?.diff ?? "").split("\n").filter(Boolean);
		const added = diff.filter((l) => l.startsWith("+")).length;
		const removed = diff.filter((l) => l.startsWith("-")).length;
		return [`Added ${lineCount(added)}, removed ${lineCount(removed)}`, diff];
	});

	// A new file shows as added lines, previewed like an edit's diff
	fileTool("Write", withGuidelines("write", createWriteToolDefinition(cwd, {})), (_result, args) => {
		const lines = String(args?.content ?? "").replace(/\n$/, "").split("\n");
		const width = String(lines.length).length;
		return [`Wrote ${lineCount(lines.length)}`, lines.map((line, i) => `+${String(i + 1).padStart(width)} ${line}`)];
	});
}
