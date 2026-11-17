import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { commandsJson, commandsJsonText, REGISTRY } from "../dist/outboundsync.js";

// commands.json is generated from REGISTRY by `npm run commands:json` and
// published (GitHub raw and the npm package) for the websites' CLI docs.
describe("commands.json", () => {
	it("matches the generator output; run `npm run commands:json` after changing a command", () => {
		const committed = readFileSync(new URL("../commands.json", import.meta.url), "utf8");
		assert.equal(committed, commandsJsonText());
	});

	it("lists every command once, sorted by id", () => {
		const ids = commandsJson().commands.map((command: { id: string }) => command.id);
		assert.deepEqual(ids, REGISTRY.map((command: { id: string }) => command.id).sort());
		assert.equal(new Set(ids).size, ids.length);
	});

	it("uses the shared cli.commands.v1 shape with no version or date", () => {
		const data = commandsJson();
		assert.deepEqual(Object.keys(data), ["schema", "cli", "commands"]);
		assert.equal(data.schema, "cli.commands.v1");
		assert.equal(data.cli, "outboundsync");
		for (const command of data.commands) {
			assert.deepEqual(Object.keys(command), ["id", "usage", "summary", "method", "path", "flags", "write", "auth"]);
			assert.match(command.usage, /^outboundsync /);
			assert.match(command.path, /^\/api\/v1\//);
			for (const flag of command.flags) {
				assert.deepEqual(
					Object.keys(flag),
					flag.values ? ["name", "help", "required", "values"] : ["name", "help", "required"],
				);
			}
		}
	});

	it("marks --yes required on every write", () => {
		for (const command of commandsJson().commands) {
			const yes = command.flags.find((flag: { name: string }) => flag.name === "yes");
			assert.equal(command.write, yes?.required === true, command.id);
		}
	});

	it("ships in the npm package", () => {
		const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { files: string[] };
		assert.ok(pkg.files.includes("commands.json"));
	});
});
