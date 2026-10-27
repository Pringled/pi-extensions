import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { normalizeContext } from "@earendil-works/pi-ai";
import { convertToLlm, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

const PROMPT = `[Heads-up mode] Look back at the last task in this conversation. Is there one thing the user should know but could easily have missed? For example a tradeoff or assumption made without saying so, something that wasn't verified, a result that looks off, or a change beyond what they asked for. Leave out anything the last reply already says clearly, and anything minor. If there is such a thing, describe it in one or two plain sentences, at most 40 words, without markdown. Otherwise reply with exactly: NONE`;
// A quick question doesn't need a second look, only real work does
const MIN_TOOL_CALLS = 3;

export default function (pi: ExtensionAPI) {
	let pending: AbortController | undefined;

	// The label in the warning color, and the note in a softer color than pi's reply, wrapped to line up after the label.
	// A blank line above keeps it apart from other widgets, such as pi-polish's turn summary
	const show = (ctx: ExtensionContext, note: string | undefined) =>
		ctx.ui.setWidget(
			"heads-up",
			note
				? (_tui, theme) => ({
						invalidate() {},
						render(width: number) {
							const label = "✦ heads-up: ";
							const indent = visibleWidth(label);
							return [
								"",
								...wrapTextWithAnsi(note, Math.max(10, width - indent - 1)).map(
									(line, i) => (i === 0 ? theme.fg("warning", label) : " ".repeat(indent)) + theme.fg("muted", line),
								),
							];
						},
					})
				: undefined,
		);

	// A new run or a jump in the session tree makes the note out of date
	const reset = async (_event: unknown, ctx: ExtensionContext) => {
		pending?.abort();
		if (ctx.mode === "tui") show(ctx, undefined);
	};
	pi.on("agent_start", reset);
	pi.on("session_tree", reset);

	pi.on("agent_end", async (event, ctx) => {
		const reply = event.messages.at(-1);
		if (ctx.mode !== "tui" || !ctx.model || reply?.role !== "assistant" || reply.stopReason !== "stop") return;
		if (ctx.hasPendingMessages() || event.messages.filter((m) => m.role === "toolResult").length < MIN_TOOL_CALLS) return;

		const controller = new AbortController();
		pending = controller;
		const level = pi.getThinkingLevel();
		const model = ctx.model;
		const ask: AgentMessage = { role: "user", content: [{ type: "text", text: PROMPT }], timestamp: Date.now() };
		// Not awaited: pi keeps its working line up until every agent_end handler returns
		void (async () => {
			try {
				// The conversation exactly as pi sends it, at the same thinking level, so the request reuses pi's prompt cache
				const answer = await ctx.modelRegistry
					.streamSimple(model, normalizeContext({ messages: convertToLlm([...ctx.sessionManager.buildSessionProjection().messages, ask]) }), {
						reasoning: model.reasoning && level !== "off" ? level : undefined,
						maxTokens: 2000,
						sessionId: ctx.sessionManager.getSessionId(),
						signal: controller.signal,
					})
					.result();
				if (controller.signal.aborted || answer.stopReason !== "stop") return;
				const note = answer.content
					.map((part) => (part.type === "text" ? part.text : ""))
					.join("")
					.replace(/`/g, "")
					.replace(/\s+/g, " ")
					.trim();
				if (note && !/^none\.?$/i.test(note)) show(ctx, note);
			} catch {
				// The note is optional, so failures stay quiet
			} finally {
				if (pending === controller) pending = undefined;
			}
		})();
	});
}
