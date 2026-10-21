import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Api, Model } from "@earendil-works/pi-ai";
import { type ExtensionAPI, type ExtensionContext, getAgentDir } from "@earendil-works/pi-coding-agent";
import { Container, fuzzyFilter, getKeybindings, Input, Key, Spacer, Text, truncateToWidth } from "@earendil-works/pi-tui";

const STATE_PATH = join(getAgentDir(), "model-picker-state.json");
const MAX_RECENTS = 8;
const MAX_VISIBLE_ROWS = 14;

interface PickerState {
	favorites: string[]; // "provider/id"
	recents: string[]; // "provider/id", most recent first
}

function loadState(): PickerState {
	try {
		const raw = JSON.parse(readFileSync(STATE_PATH, "utf-8"));
		return {
			favorites: Array.isArray(raw.favorites) ? raw.favorites : [],
			recents: Array.isArray(raw.recents) ? raw.recents : [],
		};
	} catch {
		return { favorites: [], recents: [] };
	}
}

function saveState(state: PickerState) {
	mkdirSync(dirname(STATE_PATH), { recursive: true });
	writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

function key(model: Model<Api>): string {
	return `${model.provider}/${model.id}`;
}

function formatContextWindow(n: number | undefined): string {
	if (!n) return "";
	if (n >= 1_000_000) return `${Math.round(n / 100_000) / 10}M`;
	if (n >= 1000) return `${Math.round(n / 1000)}k`;
	return String(n);
}

function capabilityTags(m: Model<Api>): string {
	const tags: string[] = [];
	if (m.reasoning) tags.push("thinking");
	if (m.input?.includes("image")) tags.push("vision");
	return tags.join(",");
}

interface Row {
	header?: string;
	model?: Model<Api>;
}

export default function (pi: ExtensionAPI) {
	let state = loadState();

	pi.on("session_start", () => {
		state = loadState();
	});

	pi.on("model_select", (event) => {
		const k = key(event.model);
		state.recents = [k, ...state.recents.filter((r) => r !== k)].slice(0, MAX_RECENTS);
		saveState(state);
	});

	function buildRows(available: Model<Api>[], query: string): Row[] {
		const byKey = new Map(available.map((m) => [key(m), m]));
		const favSet = new Set(state.favorites);
		const recentSet = new Set(state.recents);

		const favorites = state.favorites.map((k) => byKey.get(k)).filter((m): m is Model<Api> => !!m);
		const recents = state.recents
			.map((k) => byKey.get(k))
			.filter((m): m is Model<Api> => !!m && !favSet.has(key(m)));
		const rest = available
			.filter((m) => !favSet.has(key(m)) && !recentSet.has(key(m)))
			.sort((a, b) => key(a).localeCompare(key(b)));

		const rows: Row[] = [];
		for (const [title, models] of [["Favorites", favorites], ["Recent", recents], ["All", rest]] as const) {
			const matches = query ? fuzzyFilter(models, query, (m) => `${m.name ?? ""} ${m.id} ${m.provider}`) : models;
			if (matches.length === 0) continue;
			rows.push({ header: title });
			for (const m of matches) rows.push({ model: m });
		}
		return rows;
	}

	async function showPicker(ctx: ExtensionContext) {
		const available = ctx.modelRegistry.getAvailable();
		if (available.length === 0) {
			ctx.ui.notify("No available models found.", "warning");
			return;
		}

		let query = "";
		let rows: Row[] = [];
		let selectedKey: string | undefined = ctx.model ? key(ctx.model) : undefined;

		function modelRows(): Row[] {
			return rows.filter((r) => !!r.model);
		}

		function moveSelection(dir: 1 | -1) {
			const models = modelRows();
			if (models.length === 0) return;
			const curPos = models.findIndex((r) => key(r.model as Model<Api>) === selectedKey);
			const nextPos = curPos < 0 ? 0 : (curPos + dir + models.length) % models.length;
			selectedKey = key(models[nextPos].model as Model<Api>);
		}

		// Keeps the selection when it still matches, otherwise moves it to the first model
		function rebuild() {
			rows = buildRows(available, query);
			if (!rows.some((r) => r.model && key(r.model) === selectedKey)) {
				const first = rows.find((r) => r.model);
				selectedKey = first?.model ? key(first.model) : undefined;
			}
		}
		rebuild();

		const result = await ctx.ui.custom<string | null>((_tui, theme, _kb, done) => {
			const searchInput = new Input();
			searchInput.focused = true;
			const listContainer = new Container();

			function renderList(width: number) {
				listContainer.clear();

				const curIdx = rows.findIndex((r) => r.model && key(r.model) === selectedKey);
				const startIndex = Math.max(0, Math.min(curIdx - Math.floor(MAX_VISIBLE_ROWS / 2), rows.length - MAX_VISIBLE_ROWS));
				const endIndex = Math.min(startIndex + MAX_VISIBLE_ROWS, rows.length);

				if (rows.length === 0) {
					listContainer.addChild(new Text(theme.fg("muted", "  No matching models"), 0, 0));
				}

				for (let i = startIndex; i < endIndex; i++) {
					const row = rows[i];
					if (row.header) {
						listContainer.addChild(new Text(theme.fg("dim", theme.bold(`── ${row.header} ──`)), 0, 0));
						continue;
					}

					const m = row.model as Model<Api>;
					const isSelected = key(m) === selectedKey;
					const isActive = ctx.model ? key(m) === key(ctx.model) : false;

					const prefix = isSelected ? "→ " : "  ";
					const name = m.name && m.name !== m.id ? m.name : m.id;
					const badge = theme.fg("muted", ` [${m.provider}]`);
					const meta = [formatContextWindow(m.contextWindow), capabilityTags(m)].filter(Boolean).join(" ");
					const metaText = meta ? theme.fg("muted", `  ${meta}`) : "";
					const check = isActive ? theme.fg("success", " ✓") : "";

					const plain = `${prefix}${name}${badge}${metaText}${check}`;
					const line = truncateToWidth(plain, Math.max(1, width - 2), "");
					listContainer.addChild(new Text(isSelected ? theme.fg("accent", line) : line, 0, 0));
				}

				if (rows.length > MAX_VISIBLE_ROWS) {
					const total = modelRows().length;
					const pos = modelRows().findIndex((r) => key(r.model as Model<Api>) === selectedKey) + 1;
					listContainer.addChild(new Text(theme.fg("dim", `  (${pos}/${total})`), 0, 0));
				}
			}

			return {
				render(width: number) {
					renderList(width);
					const border = theme.fg("accent", "─".repeat(Math.max(1, width)));
					const container = new Container();
					container.addChild(new Text(border, 0, 0));
					container.addChild(new Spacer(1));
					container.addChild(new Text(theme.fg("accent", theme.bold("Select Model")), 0, 0));
					container.addChild(new Spacer(1));
					container.addChild(searchInput);
					container.addChild(new Spacer(1));
					container.addChild(listContainer);
					container.addChild(new Spacer(1));
					container.addChild(new Text(theme.fg("dim", "type to search • ↑↓ navigate • enter select • esc cancel"), 0, 0));
					container.addChild(new Text(border, 0, 0));
					return container.render(width);
				},
				invalidate() {
					listContainer.invalidate();
				},
				handleInput(data: string) {
					const kb = getKeybindings();
					if (kb.matches(data, "tui.select.up")) {
						moveSelection(-1);
						return;
					}
					if (kb.matches(data, "tui.select.down")) {
						moveSelection(1);
						return;
					}
					if (kb.matches(data, "tui.select.confirm")) {
						const m = rows.find((r) => r.model && key(r.model) === selectedKey)?.model;
						done(m ? key(m) : null);
						return;
					}
					if (kb.matches(data, "tui.select.cancel")) {
						done(null);
						return;
					}
					searchInput.handleInput(data);
					const nextQuery = searchInput.getValue();
					if (nextQuery !== query) {
						query = nextQuery;
						rebuild();
					}
				},
			};
		});

		if (!result) return;

		const [provider, ...idParts] = result.split("/");
		const id = idParts.join("/");
		const model = ctx.modelRegistry.find(provider, id);
		if (!model) {
			ctx.ui.notify(`Model ${result} not found`, "error");
			return;
		}

		const success = await pi.setModel(model);
		if (!success) {
			ctx.ui.notify(`No API key configured for ${result}`, "error");
		}
	}

	pi.registerCommand("pick", {
		description: "Pick a model (favorites and recents shown first)",
		handler: (_args, ctx) => showPicker(ctx),
	});

	pi.registerCommand("fav", {
		description: "Toggle the current model as a favorite in /pick",
		handler: async (_args, ctx) => {
			if (!ctx.model) {
				ctx.ui.notify("No active model", "warning");
				return;
			}
			const k = key(ctx.model);
			if (state.favorites.includes(k)) {
				state.favorites = state.favorites.filter((f) => f !== k);
				ctx.ui.notify(`Removed ${k} from favorites`, "info");
			} else {
				state.favorites = [...state.favorites, k];
				ctx.ui.notify(`Added ${k} to favorites`, "info");
			}
			saveState(state);
		},
	});

	pi.registerShortcut(Key.ctrlShift("m"), {
		description: "Open model picker (favorites/recent first)",
		handler: (ctx) => showPicker(ctx),
	});
}
