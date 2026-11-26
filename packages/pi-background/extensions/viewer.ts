import { closeSync, fstatSync, openSync, readSync } from "node:fs";
import { homedir } from "node:os";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { compositeTuiLine, Key, matchesKey, truncateToWidth, type TuiMouseEvent, visibleWidth } from "@earendil-works/pi-tui";

// How much of a job's log /bg loads for scrolling, so huge logs stay fast
const VIEW_BYTES = 1024 * 1024;
const KEY_GLYPHS: Record<string, string> = { escape: "esc", up: "↑", down: "↓", left: "←", right: "→", pageUp: "pgup", pageDown: "pgdn" };
const hintKey = (key: string | undefined, fallback: string) => KEY_GLYPHS[key ?? fallback] ?? key ?? fallback;

export interface ViewerJob {
	id: string;
	command: string;
	log: string;
	status: "running" | "exited" | "killed" | "failed";
	exitCode?: number | null;
	controller: AbortController;
}

export interface ViewerDeps<J extends ViewerJob> {
	jobs: Map<string, J>;
	maxFinished: number;
	tailLines: number;
	shownCommand: (command: string) => string;
	state: (job: J) => string;
	elapsed: (job: J) => string;
	cleanLine: (line: string) => string;
	onViewing: (job: J | undefined) => void;
	onRedraw: (redraw: () => void) => void;
}

/** Reads up to the last VIEW_BYTES of a log file as lines, skipping the read when the file size hasn't changed. */
function readLog(path: string, lastSize: number): { size: number; lines: string[]; truncated: boolean } | undefined {
	let fd: number;
	try {
		fd = openSync(path, "r");
	} catch {
		return lastSize === 0 ? undefined : { size: 0, lines: [], truncated: false };
	}
	try {
		const size = fstatSync(fd).size;
		if (size === lastSize) return undefined;
		if (size === 0) return { size: 0, lines: [], truncated: false };
		const truncated = size > VIEW_BYTES;
		const start = truncated ? size - VIEW_BYTES : 0;
		const buf = Buffer.alloc(size - start);
		let text = buf.subarray(0, readSync(fd, buf, 0, buf.length, start)).toString("utf8");
		// Start on a full line when the read began mid-line
		if (truncated) {
			const nl = text.indexOf("\n");
			if (nl >= 0) text = text.slice(nl + 1);
		}
		const trimmed = text.trimEnd();
		return { size, lines: trimmed ? trimmed.split("\n") : [], truncated };
	} finally {
		closeSync(fd);
	}
}

/** Opens the live /bg viewer in either list mode (when initial is omitted) or detail mode for one job. */
export async function openJobViewer<J extends ViewerJob>(ctx: ExtensionContext, initial: J | undefined, deps: ViewerDeps<J>): Promise<void> {
	const { jobs, maxFinished, tailLines, shownCommand, state, elapsed, cleanLine, onViewing, onRedraw } = deps;
	try {
		await ctx.ui.custom<void>((tui, theme, kb, done) => {
			let shown: J | undefined = initial;
			let selectedId: string | undefined = initial?.id;
			let listScroll = 0;
			let lastSize = -1;
			let lines: string[] = [];
			let truncated = false;
			// null follows the bottom as new output arrives; a number pins the top visible line while scrolling
			let scrollTop: number | null = null;
			let confirmKillId: string | undefined;
			let jumpPill: { row: number; col: number; width: number } | undefined;

			const setShown = (job: J | undefined) => {
				shown = job;
				confirmKillId = undefined;
				lastSize = -1;
				lines = [];
				truncated = false;
				scrollTop = null;
				if (job) selectedId = job.id;
				onViewing(job);
			};
			setShown(initial);

			// Running jobs first, then the latest finished ones
			const listed = () => {
				const all = [...jobs.values()].reverse();
				return [...all.filter((other) => other.status === "running"), ...all.filter((other) => other.status !== "running").slice(0, maxFinished)];
			};
			const selectedIndex = (items: J[]) => {
				if (items.length === 0) return -1;
				const idx = selectedId ? items.findIndex((other) => other.id === selectedId) : -1;
				return idx >= 0 ? idx : 0;
			};
			const refreshLog = () => {
				if (!shown) return;
				const next = readLog(shown.log, lastSize);
				if (!next) return;
				({ size: lastSize, lines, truncated } = next);
			};
			// At most half the terminal, so the conversation above stays in view
			const pageHeight = () => Math.max(3, Math.min(tailLines, Math.floor(tui.terminal.rows / 2)));
			const scrollLog = (delta: number) => {
				refreshLog();
				const maxTop = Math.max(0, lines.length - pageHeight());
				const current = scrollTop === null ? maxTop : Math.min(scrollTop, maxTop);
				const target = Math.max(0, Math.min(maxTop, current + delta));
				scrollTop = target >= maxTop ? null : target;
				tui.requestRender();
			};
			const moveSelection = (delta: number) => {
				const items = listed();
				if (items.length === 0) return;
				selectedId = items[Math.max(0, Math.min(items.length - 1, selectedIndex(items) + delta))].id;
				tui.requestRender();
			};
			const dotColor = (job: J) => (job.status === "running" ? "accent" : job.status === "exited" && job.exitCode === 0 ? "success" : "error");
			const frame = (width: number, header: string, body: string[], footer: string) => {
				const border = theme.fg("borderMuted", "─".repeat(width));
				return [border, header, ...body, footer, border].map((line) => truncateToWidth(line, width));
			};

			onRedraw(() => tui.requestRender());
			const timer = setInterval(() => tui.requestRender(), 1000);
			return {
				dispose: () => {
					clearInterval(timer);
					onRedraw(() => {});
				},
				invalidate() {},
				handleMouse: (event: TuiMouseEvent) => {
					if (event.type === "wheel" && event.wheelDelta) {
						if (shown) scrollLog(event.wheelDelta);
						else moveSelection(Math.sign(event.wheelDelta));
						return { handled: true };
					}
					if (event.type !== "click" || event.button !== "left") return undefined;
					if (shown && jumpPill && event.y === jumpPill.row && event.x >= jumpPill.col && event.x < jumpPill.col + jumpPill.width) {
						scrollTop = null;
						tui.requestRender();
						return { handled: true };
					}
					if (!shown) {
						const items = listed();
						const idx = listScroll + (event.y - 2);
						if (idx >= 0 && idx < items.length) {
							setShown(items[idx]);
							tui.requestRender();
							return { handled: true };
						}
					}
					return undefined;
				},
				handleInput: (data: string) => {
					if (confirmKillId) {
						const id = confirmKillId;
						confirmKillId = undefined;
						if (data === "x") {
							const target = jobs.get(id);
							if (target?.status === "running") target.controller.abort();
						}
						return tui.requestRender();
					}
					if (kb.matches(data, "tui.select.cancel") || data === "q") return done();

					const page = pageHeight();
					if (!shown) {
						const items = listed();
						const current = items[selectedIndex(items)];
						if (kb.matches(data, "tui.select.up") || data === "k") return moveSelection(-1);
						if (kb.matches(data, "tui.select.down") || data === "j") return moveSelection(1);
						if (kb.matches(data, "tui.select.pageUp")) return moveSelection(-page);
						if (kb.matches(data, "tui.select.pageDown")) return moveSelection(page);
						if ((kb.matches(data, "tui.select.confirm") || matchesKey(data, Key.right)) && current) {
							setShown(current);
							return tui.requestRender();
						}
						if (data === "x" && current?.status === "running") {
							confirmKillId = current.id;
							return tui.requestRender();
						}
						return;
					}

					if ((matchesKey(data, Key.left) || matchesKey(data, Key.backspace)) && jobs.size > 1) {
						setShown(undefined);
						return tui.requestRender();
					}
					if (data === "x" && shown.status === "running") {
						confirmKillId = shown.id;
						return tui.requestRender();
					}
					const halfPage = Math.max(1, Math.floor(page / 2));
					if (kb.matches(data, "tui.select.up") || kb.matches(data, "tui.altScreen.lineUp") || data === "k") return scrollLog(-1);
					if (kb.matches(data, "tui.select.down") || kb.matches(data, "tui.altScreen.lineDown") || data === "j") return scrollLog(1);
					if (kb.matches(data, "tui.altScreen.halfPageUp") || matchesKey(data, Key.ctrl("u"))) return scrollLog(-halfPage);
					if (kb.matches(data, "tui.altScreen.halfPageDown") || matchesKey(data, Key.ctrl("d"))) return scrollLog(halfPage);
					if (kb.matches(data, "tui.select.pageUp") || kb.matches(data, "tui.altScreen.pageUp") || data === "b") return scrollLog(-page);
					if (kb.matches(data, "tui.select.pageDown") || kb.matches(data, "tui.altScreen.pageDown") || matchesKey(data, Key.space)) return scrollLog(page);
					if (kb.matches(data, "tui.altScreen.top") || matchesKey(data, Key.home) || data === "g") {
						refreshLog();
						scrollTop = lines.length > page ? 0 : null;
						return tui.requestRender();
					}
					if (kb.matches(data, "tui.altScreen.bottom") || matchesKey(data, Key.end) || data === "G") {
						scrollTop = null;
						return tui.requestRender();
					}
					// SGR mouse wheel fallback when normalized mouse events aren't active
					const mouse = /^\x1b\[<(\d+);/.exec(data);
					if (mouse) {
						const code = Number(mouse[1]) & ~0x1c;
						if (code === 64) return scrollLog(-3);
						if (code === 65) return scrollLog(3);
					}
				},
				render(width: number) {
					const cancelHint = hintKey(kb.getKeys("tui.select.cancel")[0], "escape");
					if (confirmKillId && jobs.get(confirmKillId)?.status !== "running") confirmKillId = undefined;

					if (!shown) {
						const items = listed();
						const idx = selectedIndex(items);
						const current = items[idx];
						if (current) selectedId = current.id;
						const page = pageHeight();
						if (idx >= 0) listScroll = Math.max(idx - page + 1, Math.min(listScroll, idx));
						listScroll = Math.max(0, Math.min(listScroll, Math.max(0, items.length - page)));
						const visible = items.slice(listScroll, listScroll + page);
						const idWidth = items.length ? Math.max(...items.map((other) => other.id.length)) : 0;
						const commandWidth = items.length ? Math.max(...items.map((other) => shownCommand(other.command).length)) : 0;
						const rows =
							visible.length === 0
								? [theme.fg("dim", theme.italic("   no background jobs"))]
								: visible.map((other, i) => {
										const isSelected = listScroll + i === idx;
										const prefix = isSelected ? theme.fg("accent", " ▸ ") : "   ";
										const label = `${other.id.padEnd(idWidth)} ${shownCommand(other.command).padEnd(commandWidth)}`;
										return prefix + theme.fg(dotColor(other), "● ") + theme.fg(isSelected ? "accent" : "toolTitle", label) + theme.fg("dim", ` · ${state(other)} · ${elapsed(other)}`);
									});
						const runningCount = [...jobs.values()].filter((other) => other.status === "running").length;
						const header = theme.fg("toolTitle", " Background jobs") + (runningCount ? theme.fg("dim", ` · ${runningCount} running`) : "");
						const confirmHint = hintKey(kb.getKeys("tui.select.confirm")[0], "enter");
						const hints = [current ? `${confirmHint} open` : "", current?.status === "running" ? "x kill" : "", `${cancelHint} close`].filter(Boolean).join(" · ");
						const footer = confirmKillId ? theme.fg("warning", ` press x again to kill ${confirmKillId}`) : theme.fg("dim", ` ${hints}`);
						return frame(width, header, rows, footer);
					}

					refreshLog();
					const title = theme.fg(dotColor(shown), " ● ") + theme.fg("toolTitle", `${shown.id} ${shownCommand(shown.command)}`);
					const status = theme.fg("muted", `${state(shown)} · ${elapsed(shown)} `);
					const header = title + " ".repeat(Math.max(1, width - visibleWidth(title) - visibleWidth(status))) + status;
					const page = pageHeight();
					const maxTop = Math.max(0, lines.length - page);
					const top = scrollTop === null ? maxTop : Math.min(scrollTop, maxTop);
					const slice = lines.slice(top, top + page);
					const output = slice.length === 0 ? [theme.fg("dim", theme.italic("   no output yet"))] : slice.map((line) => `   ${cleanLine(line)}`);
					jumpPill = undefined;
					if (top < maxTop && output.length > 0) {
						const bottomKey = hintKey(kb.getKeys("tui.altScreen.bottom")[0], "end");
						const pill = truncateToWidth(theme.bg("selectedBg", theme.fg("text", ` ↓ Jump to bottom · ${bottomKey} `)), width, "");
						const pillWidth = visibleWidth(pill);
						if (pillWidth > 0) {
							const col = Math.floor((width - pillWidth) / 2);
							output[output.length - 1] = compositeTuiLine(output[output.length - 1], pill, col, pillWidth, width);
							jumpPill = { row: 2 + output.length - 1, col, width: pillWidth };
						}
					}
					const upHint = hintKey(kb.getKeys("tui.select.up")[0], "up");
					const downHint = hintKey(kb.getKeys("tui.select.down")[0], "down");
					const hints = [
						maxTop > 0 ? `${upHint}${downHint} ${top + 1}–${top + slice.length}/${lines.length}${truncated ? "+" : ""}` : "",
						shown.status === "running" ? "x kill" : "",
						jobs.size > 1 ? "← list" : "",
						`${cancelHint} close`,
						shown.log.replace(homedir(), "~"),
					]
						.filter(Boolean)
						.join(" · ");
					const footer = confirmKillId ? theme.fg("warning", ` press x again to kill ${confirmKillId}`) : theme.fg("dim", ` ${hints}`);
					return frame(width, header, output, footer);
				},
			};
		});
	} finally {
		onViewing(undefined);
		onRedraw(() => {});
	}
}
