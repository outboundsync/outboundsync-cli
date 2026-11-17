import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { REGISTRY } from "../dist/outboundsync.js";

describe("README", () => {
	it("lists exactly the registry's commands, in order", () => {
		const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
		const section = readme.split("## Commands")[1]?.split("\n## ")[0] ?? "";
		const listed = [...section.matchAll(/^\| `([^`]+)` \|/gm)].map((match) => match[1]);
		const expected = REGISTRY.map((command) => [...command.words, ...command.args.map((arg) => `<${arg.name}>`)].join(" "));
		assert.deepEqual(listed, expected);
	});

	it("marks every write command as needing --yes", () => {
		const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
		for (const command of REGISTRY) {
			if (command.scope !== "write") continue;
			const label = [...command.words, ...command.args.map((arg) => `<${arg.name}>`)].join(" ");
			const row = readme.split("\n").find((line) => line.startsWith(`| \`${label}\` |`));
			assert.ok(row?.includes("`--yes`"), `${label} row does not mention --yes`);
		}
	});
});
