import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";

const BAR_WIDTH = 20;

function fmtTokens(n: number): string {
	if (n < 1000) return `${n}`;
	if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
	return `${(n / 1_000_000).toFixed(1)}M`;
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		ctx.ui.setFooter((tui, theme, footerData) => {
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
					const filled = Math.round((pctUsed / 100) * BAR_WIDTH);
					const barColor = pctUsed >= 80 ? "error" : pctUsed >= 50 ? "warning" : "success";
					const bar = theme.fg(barColor, "█".repeat(filled)) + theme.fg("dim", "░".repeat(BAR_WIDTH - filled));

					const branch = footerData.getGitBranch();
					const branchSeg = theme.fg("mdLink", branch ? `⎇ ${branch}` : "no git");
					const modelSeg = theme.fg("accent", `${ctx.model?.provider ?? "?"}/${ctx.model?.id ?? "none"}`);
					const contextSeg =
						theme.fg("muted", "Context: [") +
						bar +
						theme.fg("muted", "] ") +
						theme.fg("mdCode", `${fmtTokens(used)}/${fmtTokens(contextWindow)}`) +
						theme.fg(barColor, ` (${pctUsed.toFixed(0)}%)`);
					const costSeg = theme.fg("success", `$${cost.toFixed(3)}`);

					const sep = theme.fg("dim", " │ ");
					const line = [modelSeg, branchSeg, contextSeg, costSeg].join(sep);

					return [truncateToWidth(line, width)];
				},
			};
		});
	});
}
