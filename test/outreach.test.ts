import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { run } from "./helpers.ts";

describe("outreach file", () => {
	it("continues after a row error and keeps the worst exit code", async () => {
		const result = await run({
			argv: ["contacts", "outreach", "--file", "people.jsonl", "--json"],
			files: {
				"people.jsonl": '{"email":"a@example.com"}\n{"profile_url":"linkedin.com/in/jane"}\n',
			},
			responses: [
				{ status: 200, body: { found: true, email: "a@example.com" } },
				{ status: 404, body: { message: "missing" } },
			],
		});
		assert.equal(result.code, 6);
		assert.equal(result.calls.length, 2);
		const lines = result.stdout.trim().split("\n").map((line) => JSON.parse(line) as { input: { email?: string }; found?: boolean; error?: { status: number } });
		assert.equal(lines[0]?.input.email, "a@example.com");
		assert.equal(lines[0]?.found, true);
		assert.equal(lines[1]?.error?.status, 404);
		assert.equal(result.stderr, "");
	});

	it("reads a CSV row and stdin", async () => {
		const csv = await run({
			argv: ["contacts", "outreach", "--file", "people.csv"],
			files: { "people.csv": "email,profile_url\nada@example.com,linkedin.com/in/ada\n" },
			responses: [{ status: 200, body: { found: false } }],
		});
		assert.equal(csv.code, 0);
		const params = new URL(csv.calls[0]?.url ?? "").searchParams;
		assert.equal(params.get("email"), "ada@example.com");
		assert.deepEqual(params.getAll("profileUrl"), ["linkedin.com/in/ada"]);
		const stdin = await run({
			argv: ["contacts", "outreach", "--file", "-"],
			stdin: '{"email":"bea@example.com"}\n',
			responses: [{ status: 200, body: { found: true } }],
		});
		assert.equal(stdin.code, 0);
		assert.equal(new URL(stdin.calls[0]?.url ?? "").searchParams.get("email"), "bea@example.com");
	});

	it("rejects a malformed file before any call", async () => {
		const result = await run({
			argv: ["contacts", "outreach", "--file", "bad.jsonl"],
			files: { "bad.jsonl": "{not json}\n" },
		});
		assert.equal(result.code, 1);
		assert.equal(result.calls.length, 0);
		assert.match(result.stderr, /invalid JSON/);
	});

	it("rejects --file combined with --email", async () => {
		const result = await run({
			argv: ["contacts", "outreach", "--file", "people.jsonl", "--email", "ada@example.com"],
			files: { "people.jsonl": '{"email":"ada@example.com"}\n' },
		});
		assert.equal(result.code, 1);
		assert.equal(result.calls.length, 0);
		assert.match(result.stderr, /cannot be combined/);
	});

	it("paces the next row from the rate-limit headers", async () => {
		const result = await run({
			argv: ["contacts", "outreach", "--file", "people.jsonl", "--json"],
			files: { "people.jsonl": '{"email":"a@example.com"}\n{"email":"b@example.com"}\n' },
			responses: [
				{ status: 200, body: { found: true }, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "2" } },
				{ status: 200, body: { found: false } },
			],
		});
		assert.equal(result.code, 0);
		assert.equal(result.calls.length, 2);
		assert.deepEqual(result.sleeps, [2000]);
	});
});
