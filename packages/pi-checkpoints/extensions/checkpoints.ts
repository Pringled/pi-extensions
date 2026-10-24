import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, rmdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import {
	getAgentDir,
	isToolCallEventType,
	type CustomEntry,
	type ExtensionAPI,
	type ExtensionContext,
	type SessionEntry,
} from "@earendil-works/pi-coding-agent";

// A file's content is stored once under its hash; null means the file didn't exist
type Blob = string | null;
// newDirs are the folders pi created for a new file, deepest first
type Checkpoint = { files: { path: string; before: Blob; after: Blob; newDirs?: string[] }[] };
type Target = { blob: Blob; newDirs?: string[] };

const ENTRY_TYPE = "checkpoint";
const BLOB_DIR = join(getAgentDir(), "checkpoints");

async function hashOf(path: string): Promise<Blob> {
	if (!existsSync(path)) return null;
	return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function save(path: string): Promise<Blob> {
	const hash = await hashOf(path);
	if (hash && !existsSync(join(BLOB_DIR, hash))) {
		await mkdir(BLOB_DIR, { recursive: true });
		await writeFile(join(BLOB_DIR, hash), await readFile(path));
	}
	return hash;
}

async function restore(path: string, { blob, newDirs = [] }: Target) {
	if (blob === null) {
		await rm(path, { force: true });
		// Only folders pi created, and only while they're empty
		for (const dir of newDirs) await rmdir(dir).catch(() => {});
		return;
	}
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, await readFile(join(BLOB_DIR, blob)));
}

// What each file should become when moving from one point in the session tree to another:
// undo the checkpoints only on the old branch, then replay the ones only on the new branch.
// A checkpoint is saved right after a run's last message, so it counts as on a branch when that message is.
// Also returns what pi last left each of those files as, to spot changes made since outside pi.
function filesToRestore(entries: SessionEntry[], from: SessionEntry[], to: SessionEntry[]) {
	const fromIds = new Set(from.map((e) => e.id));
	const toIds = new Set(to.map((e) => e.id));
	const checkpoints = entries.filter(
		(e): e is CustomEntry<Checkpoint> => e.type === "custom" && e.customType === ENTRY_TYPE && e.parentId !== null,
	);
	const only = (on: Set<string>, off: Set<string>) =>
		checkpoints.filter((e) => on.has(e.parentId!) && !off.has(e.parentId!)).map((e) => e.data!);

	const files = new Map<string, Target>();
	for (const cp of only(fromIds, toIds).reverse()) for (const f of cp.files) files.set(f.path, { blob: f.before, newDirs: f.newDirs });
	for (const cp of only(toIds, fromIds)) for (const f of cp.files) files.set(f.path, { blob: f.after });

	const lastLeft = new Map<string, Blob>();
	for (const cp of only(toIds, fromIds).reverse()) for (const f of cp.files) lastLeft.set(f.path, f.before);
	for (const cp of checkpoints.filter((e) => fromIds.has(e.parentId!))) for (const f of cp.data!.files) lastLeft.set(f.path, f.after);
	return { files, lastLeft };
}

async function offerRestore(ctx: ExtensionContext, from: SessionEntry[], to: SessionEntry[]) {
	if (!ctx.hasUI) return;
	const { files, lastLeft } = filesToRestore(ctx.sessionManager.getEntries(), from, to);
	const changes: [string, Target, boolean][] = [];
	for (const [path, target] of files) {
		const now = await hashOf(path);
		if (now !== target.blob) changes.push([path, target, now !== lastLeft.get(path)]);
	}
	if (changes.length === 0) return;

	const note = "  (changed since Pi's last edit; restoring discards those changes)";
	const list = changes.map(([path, , edited]) => `  ${relative(ctx.cwd, path)}${edited ? note : ""}`).join("\n");
	const noun = changes.length === 1 ? "file" : "files";
	if (!(await ctx.ui.confirm(`Restore ${changes.length} ${noun}?`, `Put these back to how they were at this point:\n${list}`))) return;
	for (const [path, target] of changes) await restore(path, target);
	ctx.ui.notify(`Restored ${changes.length} ${noun}`, "info");
}

export default function (pi: ExtensionAPI) {
	// The content of each file before pi first touched it in the current run
	let before = new Map<string, Promise<Blob | undefined>>();
	const newDirs = new Map<string, string[]>();

	pi.on("tool_call", async (event, ctx) => {
		if (!isToolCallEventType("edit", event) && !isToolCallEventType("write", event)) return;
		const path = resolve(ctx.cwd, event.input.path.replace(/^~(?=$|\/)/, homedir()));
		// A failed snapshot must not block the edit, so that file just isn't tracked
		if (!before.has(path)) {
			const dirs = [];
			for (let dir = dirname(path); !existsSync(dir); dir = dirname(dir)) dirs.push(dir);
			if (dirs.length > 0) newDirs.set(path, dirs);
			before.set(path, save(path).catch(() => undefined));
		}
		await before.get(path);
	});

	pi.on("agent_end", async () => {
		if (before.size === 0) return;
		const touched = before;
		before = new Map();
		const files: Checkpoint["files"] = [];
		for (const [path, pending] of touched) {
			const [was, now] = [await pending, await save(path).catch(() => undefined)];
			if (was !== undefined && now !== undefined) files.push({ path, before: was, after: now, newDirs: newDirs.get(path) });
		}
		newDirs.clear();
		if (files.length > 0) pi.appendEntry<Checkpoint>(ENTRY_TYPE, { files });
	});

	pi.on("session_tree", async (event, ctx) => {
		const branch = (id: string | null) => (id ? ctx.sessionManager.getBranch(id) : []);
		await offerRestore(ctx, branch(event.oldLeafId), branch(event.newLeafId));
	});

	pi.on("session_before_fork", async (event, ctx) => {
		const sm = ctx.sessionManager;
		const forkPoint = event.position === "before" ? sm.getEntry(event.entryId)?.parentId : event.entryId;
		await offerRestore(ctx, sm.getBranch(), forkPoint ? sm.getBranch(forkPoint) : []);
	});
}
