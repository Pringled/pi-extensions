import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { normalizeContext } from "@earendil-works/pi-ai";
import { convertToLlm, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

const PROMPT = `[Recap mode] The user stepped away from this session and is coming back to it. In one or two plain sentences, at most 40 words, recap where things stand: what was being worked on, what got done and what is next or waiting on them. Plain text without markdown, no preamble.`;
// Within the prompt cache's 5 minutes, so the recap reuses it
const DELAY_MS = 3 * 60_000;
const MIN_TURNS = 3;

export default function (pi: ExtensionAPI) {
	let timer: ReturnType<typeof setTimeout> | undefined;
	let pending: AbortController | undefined;

	// Dimmed, with the recap wrapped to line up after its label. A blank line above keeps it apart from other widgets, such as pi-polish's turn summary
	const show = (ctx: ExtensionContext, recap: string | undefined) =>
		ctx.ui.setWidget(
			"recap",
			recap
				? (_tui, theme) => ({
						invalidate() {},
						render(width: number) {
							const label = "※ recap: ";
							const indent = 1 + visibleWidth(label);
							return [
								"",
								...wrapTextWithAnsi(recap, Math.max(10, width - indent - 1)).map((line, i) =>
									theme.fg("dim", (i === 0 ? ` ${label}` : " ".repeat(indent)) + line),
								),
							];
						},
					})
				: undefined,
		);

	const cancel = () => {
		clearTimeout(timer);
		pending?.abort();
	};

	// Asks the session's model, with the conversation exactly as pi sends it, so the request reuses pi's prompt cache
	async function recap(ctx: ExtensionContext): Promise<string | undefined> {
		if (!ctx.model) return;
		const controller = new AbortController();
		pending = controller;
		const level = pi.getThinkingLevel();
		const ask: AgentMessage = { role: "user", content: [{ type: "text", text: PROMPT }], timestamp: Date.now() };
		const messages = [...ctx.sessionManager.buildSessionProjection().messages, ask];
		try {
			const answer = await ctx.modelRegistry
				.streamSimple(ctx.model, normalizeContext({ messages: convertToLlm(messages) }), {
					// The same thinking level as the session, because changing it would miss the prompt cache
					reasoning: ctx.model.reasoning && level !== "off" ? level : undefined,
					maxTokens: 2000,
					sessionId: ctx.sessionManager.getSessionId(),
					signal: controller.signal,
				})
				.result();
			if (controller.signal.aborted || answer.stopReason !== "stop") return;
			const text = answer.content.map((part) => (part.type === "text" ? part.text : "")).join("");
			return text.replace(/`/g, "").replace(/\s+/g, " ").trim() || undefined;
		} catch {
			return;
		} finally {
			if (pending === controller) pending = undefined;
		}
	}

	// A new run or a jump in the session tree makes the recap out of date
	const reset = async (_event: unknown, ctx: ExtensionContext) => {
		cancel();
		if (ctx.mode === "tui") show(ctx, undefined);
	};
	pi.on("agent_start", reset);
	pi.on("session_tree", reset);

	pi.on("agent_end", async (event, ctx) => {
		const reply = event.messages.at(-1);
		if (ctx.mode !== "tui" || reply?.role !== "assistant" || reply.stopReason !== "stop") return;
		const turns = ctx.sessionManager.getBranch().filter((e) => e.type === "message" && e.message.role === "user").length;
		if (turns < MIN_TURNS) return;
		timer = setTimeout(async () => show(ctx, await recap(ctx)), DELAY_MS);
	});

	pi.on("session_shutdown", async () => cancel());

	pi.registerCommand("recap", {
		description: "Recap where this session stands",
		handler: async (_args, ctx) => {
			// The recap line shows … while it's being written, after any run in progress has finished
			show(ctx, "…");
			await ctx.waitForIdle();
			clearTimeout(timer);
			const text = await recap(ctx);
			show(ctx, text);
			if (!text) ctx.ui.notify("Couldn't write a recap", "warning");
		},
	});
}
