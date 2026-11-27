import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { plain, startPi, until } from "../../../test/harness.mts";

const extensions = ["packages/pi-model-pick/extensions/model-pick.ts"];
const read = (file: string) => (existsSync(join(getAgentDir(), file)) ? JSON.parse(readFileSync(join(getAgentDir(), file), "utf8")) : {});

test("/pick lists favorites and recents first, filters as you type and switches to the chosen model", async () => {
	const pi = await startPi({ extensions, models: ["alpha", "beta", "gamma", "delta"] });
	const model = (id: string) => pi.faux.getModel(id)!;
	await pi.command("/fav");
	await pi.session.setModel(model("gamma"));

	const picking = pi.command("/pick");
	const picker = await until(() => pi.ui.open?.component);
	const rows = plain(picker.render(80)).filter((line) => line.startsWith("── ") || line.startsWith("  ") || line.startsWith("→"));
	assert.deepEqual(rows.map((line) => line.replace(/ \[faux\].*/, "")), ["── Favorites ──", "  alpha", "── Recent ──", "→ gamma", "── All ──", "  beta", "  delta"]);

	for (const key of "del") picker.handleInput(key);
	assert.ok(plain(picker.render(80)).some((line) => line.startsWith("→ delta")));
	picker.handleInput("\r");
	await picking;
	assert.equal(pi.session.model?.id, "delta");
	assert.deepEqual(read("model-picker-state.json"), { favorites: ["faux/alpha"], recents: ["faux/delta", "faux/gamma"] });
	await pi.dispose();
});

test("the model picked last becomes the default for new sessions, unless rememberLast is off", async () => {
	for (const rememberLast of [true, false]) {
		rmSync(join(getAgentDir(), "settings.json"), { force: true });
		const pi = await startPi({ extensions, models: ["alpha", "beta"], settings: { modelPick: { rememberLast } } });
		await pi.session.setModel(pi.faux.getModel("beta")!);
		assert.equal(read("settings.json").defaultModel, rememberLast ? "beta" : undefined);
		await pi.dispose();
	}
});

test("/fav toggles the current model as a favorite", async () => {
	const pi = await startPi({ extensions });
	await pi.command("/fav");
	await pi.command("/fav");
	assert.deepEqual(pi.ui.notes.map((n) => n.message), ["Added faux/faux-1 to favorites", "Removed faux/faux-1 from favorites"]);
	await pi.dispose();
});
