import assert from "node:assert/strict";
import { test } from "node:test";
import { shortCommand } from "../extensions/command.ts";

const cwd = "/home/me/project";

for (const [command, short] of [
	["npm test", "npm test"],
	[`cd ${cwd} && npm test`, "npm test"],
	[`cd "${cwd}"; cd . && make`, "make"],
	["cd /home/me/other && make", "cd …/other && make"],
	["cd sub; ls", "cd sub; ls"],
	["echo one\necho two", "echo one"],
]) {
	test(`shortCommand(${JSON.stringify(command)}) is ${JSON.stringify(short)}`, () => {
		assert.equal(shortCommand(command, cwd), short);
	});
}
