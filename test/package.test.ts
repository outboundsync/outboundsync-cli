import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

// npm 11 drops a bin entry whose path starts with "./" ("script name … was
// invalid and removed"), which publishes a package with no `outboundsync`
// command. Keep the path bare and the built file executable by Node.
describe("package.json", () => {
	const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
		name: string;
		bin: Record<string, string>;
		files: string[];
	};

	it("declares the outboundsync bin with a bare path npm keeps", () => {
		assert.deepEqual(pkg.bin, { outboundsync: "dist/outboundsync.js" });
	});

	it("ships the bin file with a node shebang", () => {
		assert.ok(pkg.files.includes("dist"), "files must include dist");
		const first = readFileSync(new URL(`../${pkg.bin.outboundsync}`, import.meta.url), "utf8").split("\n", 1)[0];
		assert.equal(first, "#!/usr/bin/env node");
	});
});
