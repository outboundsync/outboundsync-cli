import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { run } from "./helpers.ts";

function page(records: unknown[], hasMore: boolean, nextCursor: string | null, headers?: Record<string, string>) {
	return { status: 200, body: { data: records, hasMore, nextCursor }, headers };
}

describe("pagination", () => {
	it("follows nextCursor and stops when the server is done", async () => {
		const result = await run({
			argv: ["syncs", "list", "--since", "24h", "--all", "--json"],
			responses: [page([{ id: 1 }], true, "c2"), page([{ id: 2 }], false, null)],
		});
		assert.equal(result.code, 0);
		assert.equal(result.calls.length, 2);
		assert.equal(new URL(result.calls[1]?.url ?? "").searchParams.get("cursor"), "c2");
		assert.deepEqual(result.stdout.trim().split("\n").map((line) => JSON.parse(line)), [{ id: 1 }, { id: 2 }]);
	});

	it("prints one JSON object when --json is used without --all", async () => {
		const result = await run({
			argv: ["syncs", "list", "--since", "24h", "--json"],
			responses: [page([{ id: 1 }, { id: 2 }], false, null)],
		});
		assert.equal(result.code, 0);
		assert.equal(result.stdout.trim().split("\n").length, 1);
		const body = JSON.parse(result.stdout) as { data: unknown[] };
		assert.equal(body.data.length, 2);
	});

	it("keeps earlier records when a later page fails", async () => {
		const result = await run({
			argv: ["syncs", "list", "--since", "24h", "--all", "--json"],
			responses: [
				page([{ id: 1 }], true, "c2"),
				{ status: 500, body: { message: "boom" } },
				{ status: 500, body: { message: "boom" } },
			],
		});
		assert.equal(result.code, 5);
		assert.equal(result.calls.length, 3);
		assert.deepEqual(JSON.parse(result.stdout), { id: 1 });
		assert.match(result.stderr, /boom/);
	});

	it("stops at --max-pages after printing the pages it fetched", async () => {
		const result = await run({
			argv: ["syncs", "list", "--since", "24h", "--all", "--max-pages", "1"],
			responses: [page([{ id: 1 }], true, "c2")],
		});
		assert.equal(result.code, 1);
		assert.equal(result.calls.length, 1);
		assert.match(result.stdout, /"id": 1/);
		assert.match(result.stderr, /--max-pages/);
	});

	it("paces the next page when the remaining budget is spent", async () => {
		const result = await run({
			argv: ["syncs", "list", "--since", "24h", "--all", "--json"],
			responses: [
				page([{ id: 1 }], true, "c2", { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "2" }),
				page([{ id: 2 }], false, null),
			],
		});
		assert.equal(result.code, 0);
		assert.deepEqual(result.sleeps, [2000]);
	});
});

describe("summaries", () => {
	it("prints account, status, and setup lines without --json", async () => {
		const me = await run({
			argv: ["me"],
			responses: [
				{
					status: 200,
					body: {
						account: { id: 7, email: "ada@example.com" },
						apiKey: { scopes: ["read"], connectionScope: "account" },
					},
				},
			],
		});
		assert.equal(me.code, 0);
		assert.match(me.stdout, /account ada@example.com · scopes read · connection scope account/);
		const status = await run({
			argv: ["account", "status"],
			responses: [{ status: 200, body: { ready: false, blockers: [{ code: "crm_disconnected" }] } }],
		});
		assert.equal(status.code, 0);
		assert.match(status.stdout, /ready: no/);
		assert.match(status.stdout, /blockers: crm_disconnected/);
		const setup = await run({
			argv: ["setup"],
			responses: [{ status: 200, body: { steps: [{ status: "ready" }, { status: "pending" }] } }],
		});
		assert.match(setup.stdout, /steps ready: 1\/2/);
		const list = await run({
			argv: ["connections", "list"],
			responses: [{ status: 200, body: { connections: [{ id: 1 }, { id: 2 }] } }],
		});
		assert.match(list.stdout, /2 records/);
	});

	it("does not print a summary with --json", async () => {
		const result = await run({
			argv: ["account", "status", "--json"],
			responses: [{ status: 200, body: { ready: false, blockers: [] } }],
		});
		assert.equal(result.code, 0);
		assert.deepEqual(JSON.parse(result.stdout), { ready: false, blockers: [] });
	});
});
