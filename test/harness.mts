import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type FauxResponseStep, fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import {
	createAgentSession,
	DefaultResourceLoader,
	type ExtensionContext,
	initTheme,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences } from "@earendil-works/pi-tui";

export { fauxAssistantMessage, fauxToolCall };

// Everything Pi or an extension saves goes to a throwaway folder instead of ~/.pi
const home = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "pi-test-"));
process.env.PI_CODING_AGENT_DIR = home;
initTheme("dark", false);

// Colors and styles leave the text as it is, so tests compare plain lines
export const theme: any = new Proxy({ appearance: "dark", name: "plain" }, {
	get: (target: any, prop) => (prop in target ? target[prop] : (...args: unknown[]) => (typeof args.at(-1) === "string" ? args.at(-1) : "")),
});

export const plain = (lines: readonly string[]) => lines.map((line) => stripTerminalSequences(line).trimEnd());

/** A terminal UI that records what extensions show in it, for tests to read back and answer. */
export class FakeUI {
	widgets = new Map<string, any>();
	notes: { message: string; type?: string }[] = [];
	footer: any;
	editor: any;
	/** The component open with ctx.ui.custom, and how to close it */
	open?: { component: any; done: (value?: unknown) => void };
	/** Answers for the next confirm dialogs, in order; confirm says yes when none is left */
	answers: unknown[] = [];
	dialogs: { title: string; body: unknown }[] = [];
	inputs: ((data: string) => { consume?: boolean; data?: string } | undefined)[] = [];
	tui = { requestRender() {}, terminal: { rows: 40, columns: 100 } };
	theme = theme;

	/** The ctx.ui extensions get: these methods, and no-ops for the rest of Pi's UI */
	context(): any {
		const methods = Object.getOwnPropertyNames(FakeUI.prototype).filter((name) => name !== "constructor");
		const noop = () => undefined;
		const rest = ["input", "setStatus", "setWorkingVisible", "setWorkingIndicator", "setHiddenThinkingLabel", "setHeader", "setTitle", "pasteToEditor", "setEditorText", "getEditorText", "addAutocompleteProvider", "getAllThemes", "getTheme", "setTheme", "getToolsExpanded", "setToolsExpanded"];
		return {
			...Object.fromEntries(rest.map((name) => [name, noop])),
			...Object.fromEntries(methods.map((name) => [name, (this as any)[name].bind(this)])),
			theme,
		};
	}

	setWidget(key: string, content: any) {
		if (content === undefined) this.widgets.delete(key);
		else this.widgets.set(key, typeof content === "function" ? content(this.tui, theme) : content);
	}
	/** The lines a widget shows at this width, or undefined when it isn't set */
	widget(key: string, width = 100): string[] | undefined {
		const component = this.widgets.get(key);
		return component && (Array.isArray(component) ? component : plain(component.render(width)));
	}
	notify(message: string, type?: string) {
		this.notes.push({ message, type });
	}
	async confirm(title: string, body: string) {
		this.dialogs.push({ title, body });
		return this.answers.length ? Boolean(this.answers.shift()) : true;
	}
	async select(title: string, options: string[]) {
		this.dialogs.push({ title, body: options });
		const answer = this.answers.shift();
		return typeof answer === "function" ? answer(options) : (answer as string | undefined);
	}
	custom(factory: any) {
		return new Promise((resolve) => {
			const done = (value?: unknown) => {
				this.open?.component.dispose?.();
				this.open = undefined;
				resolve(value);
			};
			this.open = { component: factory(this.tui, theme, undefined, done), done };
		});
	}
	setFooter(factory: any) {
		this.footer = factory?.(this.tui, theme, this.footerData);
	}
	footerData = { onBranchChange: () => () => {}, getGitBranch: () => "main", getExtensionStatuses: () => new Map<string, string>() };
	onTerminalInput(handler: (data: string) => any) {
		this.inputs.push(handler);
		return () => {
			this.inputs = this.inputs.filter((h) => h !== handler);
		};
	}
	/** Sends raw terminal input through the extensions' input handlers; true when one consumed it */
	input(data: string): boolean {
		return this.inputs.some((handler) => handler(data)?.consume);
	}
	working?: string;
	setWorkingMessage(message?: string) {
		this.working = message;
	}
	getEditorComponent() {
		return this.editor;
	}
	setEditorComponent(factory: any) {
		this.editor = factory;
	}
}

export interface PiOptions {
	/** Extension files, relative to the repo root */
	extensions: string[];
	/** The model's replies, in order */
	replies?: FauxResponseStep[];
	mode?: ExtensionContext["mode"];
	/** Pi's settings.json */
	settings?: Record<string, unknown>;
	/** Model ids the scripted provider offers; the first one is used */
	models?: string[];
	/** The editor Pi would show, for extensions that wrap it */
	editor?: (tui: any, theme: any, keybindings: any) => any;
}

/** A Pi session with the given extensions loaded as Pi loads them, a scripted model and a fake terminal UI. */
export async function startPi({ extensions, replies = [], mode = "tui", settings = {}, models, editor }: PiOptions) {
	const dir = mkdtempSync(join(home, "project-"));
	const faux = fauxProvider(models ? { models: models.map((id) => ({ id })) } : undefined);
	const [model] = faux.models;
	const modelRuntime = await ModelRuntime.create({ authPath: join(home, "auth.json"), modelsPath: null, refreshOnCreate: false });
	modelRuntime.registerProvider(model.provider, { api: faux.api as any, apiKey: "test", streamSimple: faux.provider.streamSimple as any, models: faux.models as any });
	const resourceLoader = new DefaultResourceLoader({
		cwd: dir,
		agentDir: home,
		noExtensions: true,
		additionalExtensionPaths: extensions.map((path) => resolve(import.meta.dirname, "..", path)),
	} as any);
	await resourceLoader.reload();
	const { session } = await createAgentSession({
		cwd: dir,
		agentDir: home,
		modelRuntime,
		model: modelRuntime.getModel(model.provider, model.id),
		resourceLoader,
		sessionManager: SessionManager.inMemory(dir),
		settingsManager: SettingsManager.inMemory(settings as any),
	});
	faux.setResponses(replies);
	const ui = new FakeUI();
	ui.editor = editor;
	const errors: unknown[] = [];
	await session.bindExtensions({ uiContext: mode === "tui" ? ui.context() : undefined, mode, onError: (error) => errors.push(error) });
	const runner = session.extensionRunner;
	return {
		session,
		faux,
		ui,
		cwd: dir,
		runner,
		/** Runs a slash command as if typed, with the session's context */
		command: async (line: string) => {
			const [name, ...args] = line.replace(/^\//, "").split(" ");
			const command = runner.getCommand(name);
			if (!command) throw new Error(`No command /${name}`);
			await command.handler(args.join(" "), runner.createCommandContext());
		},
		/** Quits as Pi does, telling extensions first so they can stop what they started, and fails if an extension threw meanwhile, which Pi only logs */
		dispose: async () => {
			await runner.emit({ type: "session_shutdown", reason: "quit" });
			session.dispose();
			if (errors.length) throw new Error(`Extension error: ${JSON.stringify(errors[0], null, 2)}`);
		},
	};
}

/** Resolves once check() returns something truthy, or fails after timeout ms. */
export async function until<T>(check: () => T, timeout = 5000): Promise<NonNullable<T>> {
	const end = Date.now() + timeout;
	for (;;) {
		const value = check();
		if (value) return value;
		if (Date.now() > end) throw new Error(`Timed out waiting for ${check}`);
		await new Promise((r) => setTimeout(r, 20));
	}
}
