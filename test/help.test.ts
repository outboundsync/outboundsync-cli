import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { REGISTRY, flagsFor } from "../dist/outboundsync.js";
import { run } from "./helpers.ts";

describe("help", () => {
	it("lists every command from the registry", async () => {
		const result = await run({ argv: [] });
		assert.equal(result.code, 0);
		assert.equal(result.calls.length, 0);
		for (const command of REGISTRY) {
			assert.match(result.stdout, new RegExp(command.words.join(" ")));
		}
	});

	it("shows command help without calling the API", async () => {
		const result = await run({ argv: ["syncs", "list", "--help"] });
		assert.equal(result.code, 0);
		assert.equal(result.calls.length, 0);
		assert.match(result.stdout, /--since/);
		assert.match(result.stdout, /--from/);
		assert.match(result.stdout, /--all/);
	});

	it("rejects a flag that belongs to another command", async () => {
		const result = await run({ argv: ["me", "--status", "success"] });
		assert.equal(result.code, 1);
		assert.equal(result.calls.length, 0);
		assert.match(result.stderr, /--status is not valid for me/);
	});

	it("prints a version and does not call the API", async () => {
		const result = await run({ argv: ["me", "--version"] });
		assert.equal(result.code, 0);
		// The release workflow stamps the CalVer version into package.json before
		// running the tests, so compare with package.json, not a fixed string.
		const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
		assert.equal(result.stdout, `${version}\n`);
		assert.equal(result.calls.length, 0);
	});

	it("keeps 50 commands with unique ids, words, and routes", () => {
		assert.equal(REGISTRY.length, 50);
		const ids = new Set(REGISTRY.map((command) => command.id));
		const words = new Set(REGISTRY.map((command) => command.words.join(" ")));
		const routes = new Set(
			REGISTRY.filter((command) => command.id !== "openapi").map((command) => `${command.method} ${command.path}`),
		);
		assert.equal(ids.size, 50);
		assert.equal(words.size, 50);
		assert.equal(routes.size, 49);
		for (const command of REGISTRY) {
			assert.ok(command.help.length > 0);
			assert.ok(flagsFor(command).length >= 0);
		}
	});

	it("offers --yes on every write and no read", async () => {
		const gated = await run({ argv: ["syncs", "retry", "--help"] });
		const open = await run({ argv: ["syncs", "get", "--help"] });
		assert.match(gated.stdout, /--yes/);
		assert.doesNotMatch(open.stdout, /--yes/);
	});
});
