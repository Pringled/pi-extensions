import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

const BAR_WIDTH = 20;
const MIN_BAR_WIDTH = 5;

function fmtTokens(n: number): string {
	if (n < 1000) return `${n}`;
	if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
	return `${(n / 1_000_000).toFixed(1)}M`;
}

export default function (pi: ExtensionAPI) {
	let redraw = () => {};
	pi.on("thinking_level_select", async () => redraw());

	pi.on("session_start", async (_event, ctx) => {
		ctx.ui.setFooter((tui, theme, footerData) => {
			redraw = () => tui.requestRender();
			const unsub = footerData.onBranchChange(() => tui.requestRender());

			return {
				dispose: unsub,
				invalidate() {},
				render(width: number): string[] {
					let cost = 0;
					for (const e of ctx.sessionManager.getBranch()) {
						if (e.type === "message" && e.message.role === "assistant") {
							const m = e.message as AssistantMessage;
							cost += m.usage.cost.total;
						}
					}

					const contextUsage = ctx.getContextUsage();
					const used = contextUsage?.tokens ?? 0;
					const contextWindow = contextUsage?.contextWindow ?? ctx.model?.contextWindow ?? 0;
					// percent is null when the token count is unknown, e.g. right after compaction
					const pctUsed = Math.min(100, Math.max(0, contextUsage?.percent ?? (contextWindow > 0 ? (used / contextWindow) * 100 : 0)));
					const barColor = pctUsed >= 80 ? "error" : pctUsed >= 50 ? "warning" : "success";
					const bar = (size: number) => {
						const filled = Math.round((pctUsed / 100) * size);
						return theme.fg(barColor, "█".repeat(filled)) + theme.fg("dim", "░".repeat(size - filled));
					};

					const branch = footerData.getGitBranch();
					const branchSeg = theme.fg("mdLink", branch ? `⎇ ${branch}` : "no git");
					// The thinking level only means something for models that can think
					const thinking = ctx.model?.reasoning ? theme.fg("muted", ` · ${pi.getThinkingLevel()}`) : "";
					const modelSeg = theme.fg("accent", `${ctx.model?.provider ?? "?"}/${ctx.model?.id ?? "none"}`) + thinking;
					const contextSeg = (barSize: number) =>
						theme.fg("muted", "Context: [") +
						bar(barSize) +
						theme.fg("muted", "] ") +
						theme.fg("mdCode", `${fmtTokens(used)}/${fmtTokens(contextWindow)}`) +
						theme.fg(barColor, ` (${pctUsed.toFixed(0)}%)`);
					// A local or otherwise free model has no prices, so a cost that's still $0 says nothing
					const free = !ctx.model?.cost?.input && !ctx.model?.cost?.output;
					const costSeg = free && cost === 0 ? undefined : theme.fg("success", `$${cost.toFixed(3)}`);

					const sep = theme.fg("dim", " │ ");
					const line = (barSize: number) => [modelSeg, branchSeg, contextSeg(barSize), costSeg].filter(Boolean).join(sep);

					// Shrink the bar before cutting anything off, so the cost stays visible in narrow windows
					const overflow = visibleWidth(line(BAR_WIDTH)) - width;
					const barSize = Math.max(MIN_BAR_WIDTH, BAR_WIDTH - Math.max(0, overflow));
					return [truncateToWidth(line(barSize), width)];
				},
			};
		});
	});
}
