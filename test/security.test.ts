import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { run } from "./helpers.ts";

const TOKEN = "osapi_test_secret_value";
const CLI = fileURLToPath(new URL("../dist/outboundsync.js", import.meta.url));

describe("api key transport", () => {
	it("does not follow a redirect and never sends the key twice", async () => {
		const seen: { url: string; redirect: RequestRedirect | undefined }[] = [];
		const result = await run({
			argv: ["me"],
			fetchImpl: async (url, init) => {
				seen.push({ url: String(url), redirect: init?.redirect });
				return new Response("", { status: 302, headers: { location: "https://evil.example/steal" } });
			},
		});
		assert.equal(result.code, 6);
		assert.equal(seen.length, 1);
		assert.equal(seen[0]?.redirect, "manual");
		assert.match(result.stderr, /does not follow redirects/);
		assert.doesNotMatch(result.stderr, new RegExp(TOKEN));
	});

	for (const base of ["http://api.example.com/api/v1", "https://user:pw@app.outboundsync.com/api/v1", "https://app.outboundsync.com/api/v1?x=1", "ftp://example.com"]) {
		it(`rejects --base-url ${base} before any request`, async () => {
			const result = await run({ argv: ["me", "--base-url", base] });
			assert.equal(result.code, 1);
			assert.equal(result.calls.length, 0);
		});
	}

	it("allows plain http only for a loopback dev server", async () => {
		const result = await run({
			argv: ["me", "--base-url", "http://localhost:3000/api/v1/"],
			responses: [{ status: 200, body: { ok: true } }],
		});
		assert.equal(result.code, 0);
		assert.equal(result.calls[0]?.url, "http://localhost:3000/api/v1/me");
	});

	it("rejects a key with whitespace without echoing it", async () => {
		const result = await run({ argv: ["me"], env: { OUTBOUNDSYNC_API_KEY: "osapi_abc def" } });
		assert.equal(result.code, 1);
		assert.equal(result.calls.length, 0);
		assert.doesNotMatch(result.stderr, /osapi_abc/);
	});

	it("redacts a key the server echoes back", async () => {
		const result = await run({
			argv: ["me"],
			responses: [{ status: 401, body: { message: `bad key ${TOKEN}` } }],
		});
		assert.equal(result.code, 2);
		assert.doesNotMatch(result.stderr + result.stdout, new RegExp(TOKEN));
	});

	it("rejects dot-segment ids that would resolve to another route", async () => {
		for (const id of [".", ".."]) {
			const result = await run({ argv: ["webhooks", "delete", id, "--yes"] });
			assert.equal(result.code, 1);
			assert.equal(result.calls.length, 0);
		}
	});
});

describe("terminal safety", () => {
	const hostile = "ok\u001b]0;pwned\u0007\u001b[2J\u009b31m\u202egnp.exe";

	it("escapes control and bidi characters in pretty output", async () => {
		const result = await run({ argv: ["me"], responses: [{ status: 200, body: { account: { email: hostile } } }] });
		assert.equal(result.code, 0);
		assert.doesNotMatch(result.stdout, /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e]/);
	});

	it("keeps --json parseable to the same value", async () => {
		const result = await run({ argv: ["me", "--json"], responses: [{ status: 200, body: { name: hostile } }] });
		assert.doesNotMatch(result.stdout, /[\u007f-\u009f\u202a-\u202e]/);
		assert.deepEqual(JSON.parse(result.stdout), { name: hostile });
	});

	it("escapes control characters in an API error message", async () => {
		const result = await run({ argv: ["me"], responses: [{ status: 400, body: { message: hostile } }] });
		assert.equal(result.code, 6);
		assert.doesNotMatch(result.stderr, /[\u001b\u0007\u009b\u202e]/);
		assert.match(result.stderr, /\\u001b/);
	});

	it("escapes raw openapi text", async () => {
		const result = await run({ argv: ["openapi"], responses: [{ status: 200, text: `openapi: 3.1.0\n# ${hostile}\n` }] });
		assert.equal(result.code, 0);
		assert.doesNotMatch(result.stdout, /[\u001b\u009b]/);
	});
});

describe("pacing", () => {
	it("caps a huge X-RateLimit-Reset at 60 seconds", async () => {
		const result = await run({
			argv: ["syncs", "list", "--since", "24h", "--all"],
			responses: [
				{ status: 200, body: { data: [1], hasMore: true, nextCursor: "c2" }, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "999999" } },
				{ status: 200, body: { data: [2], hasMore: false, nextCursor: null } },
			],
		});
		assert.equal(result.code, 0);
		assert.deepEqual(result.sleeps, [60_000]);
	});
});

describe("contact file bounds", () => {
	it("rejects input over 5 MiB before any request", async () => {
		const big = `email\n${"a@example.com\n".repeat(420_000)}`;
		const result = await run({ argv: ["contacts", "outreach", "--file", "-"], stdin: big });
		assert.equal(result.code, 1);
		assert.equal(result.calls.length, 0);
		assert.match(result.stderr, /larger than/);
	});

	it("rejects more than 10,000 rows before any request", async () => {
		const many = `email\n${"a@example.com\n".repeat(10_001)}`;
		const result = await run({ argv: ["contacts", "outreach", "--file", "-"], stdin: many });
		assert.equal(result.code, 1);
		assert.equal(result.calls.length, 0);
		assert.match(result.stderr, /maximum is 10000/);
	});

	function cli(args: string[]): { status: number | null; stderr: string } {
		const out = spawnSync(process.execPath, [CLI, ...args], {
			env: { PATH: process.env.PATH, OUTBOUNDSYNC_API_KEY: TOKEN, OUTBOUNDSYNC_API_BASE_URL: "https://127.0.0.1:9/api/v1" },
			encoding: "utf8",
		});
		return { status: out.status, stderr: out.stderr };
	}

	it("rejects a directory as --file", () => {
		const dir = mkdtempSync(path.join(tmpdir(), "osync-cli-"));
		const result = cli(["contacts", "outreach", "--file", dir]);
		assert.equal(result.status, 1);
		assert.match(result.stderr, /regular file/);
	});

	it("rejects a missing --file without a stack trace", () => {
		const result = cli(["contacts", "outreach", "--file", "/nonexistent/contacts.csv"]);
		assert.equal(result.status, 1);
		assert.match(result.stderr, /no such file/);
		assert.doesNotMatch(result.stderr, /at .*\.js/);
	});

	it("reads a regular file", () => {
		const dir = mkdtempSync(path.join(tmpdir(), "osync-cli-"));
		const file = path.join(dir, "rows.csv");
		writeFileSync(file, "email\nnot-an-email\n");
		const result = cli(["contacts", "outreach", "--file", file]);
		assert.equal(result.status, 1);
		assert.match(result.stderr, /line 2: invalid email/);
	});
});
