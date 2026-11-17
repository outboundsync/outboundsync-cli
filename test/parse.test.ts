import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseArgv } from "../dist/outboundsync.js";

describe("parseArgv", () => {
	it("rejects an unknown flag", () => {
		assert.throws(() => parseArgv(["me", "--bogus"]), /unknown flag --bogus/);
	});

	it("collects repeatable flags", () => {
		const parsed = parseArgv(["events", "list", "--type", "a", "--type=b"]);
		assert.deepEqual(parsed.flags.type, ["a", "b"]);
	});

	it("accepts --flag=value", () => {
		const parsed = parseArgv(["events", "list", "--delivered=false"]);
		assert.equal(parsed.flags.delivered, "false");
	});

	it("rejects a value on a boolean flag", () => {
		assert.throws(() => parseArgv(["--json=true"]), /--json does not take a value/);
		assert.throws(() => parseArgv(["syncs", "list", "--all=true"]), /--all does not take a value/);
	});

	it("rejects a repeated non-repeatable flag", () => {
		assert.throws(() => parseArgv(["syncs", "list", "--since", "24h", "--since", "7d"]), /--since was passed more than once/);
	});

	it("stops flags after --", () => {
		const parsed = parseArgv(["me", "--", "--token", "secret"]);
		assert.deepEqual(parsed.positionals, ["me", "--token", "secret"]);
		assert.deepEqual(parsed.flags, {});
	});

	it("rejects a value that starts with --", () => {
		assert.throws(() => parseArgv(["syncs", "list", "--from", "--to"]), /--from requires a value/);
	});
});
