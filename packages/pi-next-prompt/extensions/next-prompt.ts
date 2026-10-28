import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { normalizeContext } from "@earendil-works/pi-ai";
import { convertToLlm, CustomEditor, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

const PROMPT = `[Suggestion mode] Predict what the user will type next in this conversation. Write it the way they would: a short instruction, question or reply in their language and tone, under 12 words. A good suggestion is the obvious next step, such as approving something you proposed or asking for the follow-up they are likely to want. Reply with only the suggestion, no quotes. If there is no obvious next step, reply with nothing.`;
const MAX_LENGTH = 100;

export default function (pi: ExtensionAPI) {
	let suggestion = "";
	let lastRequest: AgentMessage[] = [];
	let pending: AbortController | undefined;
	let redraw = () => {};

	const clear = () => {
		pending?.abort();
		pending = undefined;
		if (suggestion) {
			suggestion = "";
			redraw();
		}
	};

	// The messages pi last sent, so the suggestion request starts with the same prefix and reuses its prompt cache
	pi.on("context_with_system", async (event) => {
		lastRequest = event.messages;
	});
	pi.on("agent_start", async () => clear());
	pi.on("session_tree", async () => clear());

	pi.on("agent_end", async (event, ctx) => {
		const reply = event.messages.at(-1);
		if (ctx.mode !== "tui" || !ctx.model || reply?.role !== "assistant" || reply.stopReason !== "stop") return;
		if (ctx.hasPendingMessages()) return;

		const controller = new AbortController();
		pending = controller;
		const level = pi.getThinkingLevel();
		const model = ctx.model;
		const ask: AgentMessage = { role: "user", content: [{ type: "text", text: PROMPT }], timestamp: Date.now() };
		// Not awaited: pi keeps its working line up until every agent_end handler returns
		void (async () => {
			try {
				const answer = await ctx.modelRegistry
					.streamSimple(model, normalizeContext({ messages: convertToLlm([...lastRequest, reply, ask]) }), {
						// The same thinking level as the session, because changing it would miss the prompt cache
						reasoning: model.reasoning && level !== "off" ? level : undefined,
						maxTokens: 2000,
						sessionId: ctx.sessionManager.getSessionId(),
						signal: controller.signal,
					})
					.result();
				if (controller.signal.aborted || answer.stopReason !== "stop") return;
				const text = answer.content
					.map((part) => (part.type === "text" ? part.text : ""))
					.join("")
					.trim()
					.replace(/^["'`]|["'`]$/g, "");
				if (!text || text.includes("\n") || text.length > MAX_LENGTH) return;
				suggestion = text;
				redraw();
			} catch {
				// A suggestion is optional, so failures stay quiet
			} finally {
				if (pending === controller) pending = undefined;
			}
		})();
	});

	pi.on("session_start", async (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		const previous = ctx.ui.getEditorComponent();
		ctx.ui.setEditorComponent((tui, theme, keybindings) => {
			const editor = previous?.(tui, theme, keybindings) ?? new CustomEditor(tui, theme, keybindings);
			redraw = () => tui.requestRender();

			// Tab or → takes the suggestion while the editor is empty. It only shows while the editor is empty, so typing hides it
			// and it comes back when the text is deleted again, like in Claude Code; esc dismisses it until the next reply
			const handleInput = editor.handleInput.bind(editor);
			editor.handleInput = (data: string) => {
				if (suggestion && editor.getText() === "" && (matchesKey(data, Key.tab) || matchesKey(data, Key.right))) {
					editor.setText(suggestion);
					suggestion = "";
					return;
				}
				handleInput(data);
				if (suggestion && matchesKey(data, Key.escape)) suggestion = "";
			};

			const render = editor.render.bind(editor);
			editor.render = (width: number) => {
				const lines = render(width);
				// An empty editor's first line ends in plain spaces after the cursor; the suggestion goes there in grey
				const blank = suggestion && editor.getText() === "" ? lines[1]?.match(/ {3,}$/)?.[0] : undefined;
				if (blank) {
					const ghost = truncateToWidth(suggestion, blank.length - 2, "…");
					lines[1] = lines[1].slice(0, -blank.length) + ctx.ui.theme.fg("dim", ghost) + " ".repeat(blank.length - visibleWidth(ghost));
				}
				return lines;
			};
			return editor;
		});
	});
}
