import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { header, run } from "./helpers.ts";

const KEY = "osapi_test_secret_value";

describe("client", () => {
	it("retries a 429 once when Retry-After fits the budget", async () => {
		const result = await run({
			argv: ["me"],
			responses: [
				{ status: 429, body: { message: "slow down" }, headers: { "retry-after": "1" } },
				{ status: 200, body: { account: { id: 1, email: "ada@example.com" }, apiKey: { scopes: ["read"], connectionScope: "account" } } },
			],
		});
		assert.equal(result.code, 0);
		assert.equal(result.calls.length, 2);
		assert.deepEqual(result.sleeps, [1000]);
	});

	it("does not retry a 429 whose wait exceeds the budget", async () => {
		const result = await run({
			argv: ["me"],
			responses: [{ status: 429, body: { message: "slow down" }, headers: { "retry-after": "60" } }],
		});
		assert.equal(result.code, 4);
		assert.equal(result.calls.length, 1);
		assert.deepEqual(result.sleeps, []);
		assert.match(result.stderr, /Limits are shared per account/);
	});

	it("retries one GET 500 and never retries a POST 500", async () => {
		const read = await run({
			argv: ["me"],
			responses: [
				{ status: 500, body: { message: "boom" } },
				{ status: 200, body: { account: { id: 1, email: "ada@example.com" }, apiKey: { scopes: ["read"], connectionScope: "account" } } },
			],
		});
		assert.equal(read.code, 0);
		assert.equal(read.calls.length, 2);
		assert.deepEqual(read.sleeps, [1000]);
		const write = await run({
			argv: ["syncs", "retry", "9", "--yes"],
			responses: [{ status: 500, body: { message: "boom" } }],
		});
		assert.equal(write.code, 5);
		assert.equal(write.calls.length, 1);
		assert.deepEqual(write.sleeps, []);
	});

	it("does not retry a 504 and passes on the API's hint", async () => {
		const result = await run({
			argv: ["syncs", "list", "--since", "7d"],
			responses: [{ status: 504, body: { message: "Request exceeded the 10s query time limit. Narrow the from/to window or pass connectionId." } }],
		});
		assert.equal(result.code, 5);
		assert.equal(result.calls.length, 1);
		assert.match(result.stderr, /Narrow the from\/to window or pass connectionId\./);
	});

	it("hides a non-JSON success body", async () => {
		const result = await run({
			argv: ["me"],
			responses: [{ status: 200, text: "<html>nope</html>" }],
		});
		assert.equal(result.code, 5);
		assert.doesNotMatch(result.stderr, /<html>/);
		assert.doesNotMatch(result.stdout, /<html>/);
	});

	it("maps a timeout and a network error to exit 5", async () => {
		const timeout = await run({
			argv: ["me"],
			fetchImpl: async () => {
				const error = new Error("timed out");
				error.name = "TimeoutError";
				throw error;
			},
		});
		assert.equal(timeout.code, 5);
		assert.match(timeout.stderr, /did not answer/);
		const network = await run({
			argv: ["contacts", "outreach", "--email", "ada@example.com"],
			fetchImpl: async (url) => {
				throw new Error(`connect failed ${String(url)}`);
			},
		});
		assert.equal(network.code, 5);
		assert.doesNotMatch(network.stderr, /ada@example.com/);
		assert.doesNotMatch(network.stderr, /\?email=/);
		assert.match(network.stderr, /GET \/contacts\/outreach/);
	});

	it("words each 403 cause for the CLI", async () => {
		const cases = [
			["This key is not account-scoped", /account-scoped key/],
			["Platform webhooks are not enabled", /Platform webhooks/],
			["Block lists are not enabled", /Block lists/],
			["Missing write scope", /write scope/],
			["API access is not enabled", /no API call for this/],
		] as const;
		for (const [message, pattern] of cases) {
			const result = await run({ argv: ["me"], responses: [{ status: 403, body: { message } }] });
			assert.equal(result.code, 3);
			assert.match(result.stderr, pattern);
		}
	});

	it("explains a bulk-retry 409 and leaves other 409s as HTTP errors", async () => {
		const bulk = await run({
			argv: ["sources", "retry-syncs", "4", "--yes"],
			responses: [
				{
					status: 409,
					body: { message: "already queued", retryAfterSeconds: 3600, retryAvailableAt: "2026-08-14T00:00:00.000Z" },
				},
			],
		});
		assert.equal(bulk.code, 6);
		assert.match(bulk.stderr, /2026-08-14T00:00:00.000Z/);
		assert.match(bulk.stderr, /syncs retry <id>/);
		const other = await run({
			argv: ["syncs", "retry", "4", "--yes"],
			responses: [{ status: 409, body: { message: "not failed" } }],
		});
		assert.equal(other.code, 6);
		assert.match(other.stderr, /not failed/);
		assert.doesNotMatch(other.stderr, /syncs retry/);
	});

	it("exits 2 on a 401 and redacts the key", async () => {
		const result = await run({
			argv: ["me"],
			responses: [{ status: 401, body: { message: `bad key ${KEY}` } }],
		});
		assert.equal(result.code, 2);
		assert.doesNotMatch(result.stdout, new RegExp(KEY));
		assert.doesNotMatch(result.stderr, new RegExp(KEY));
		assert.match(result.stderr, /\[redacted\]/);
	});

	it("prints an OpenAPI document without sending a token", async () => {
		const yaml = await run({
			argv: ["openapi"],
			responses: [{ status: 200, text: "openapi: 3.1.0\n" }],
		});
		assert.equal(yaml.code, 0);
		assert.equal(yaml.stdout, "openapi: 3.1.0\n");
		assert.equal(header(yaml.calls[0]?.headers ?? {}, "authorization"), undefined);
		assert.equal(new URL(yaml.calls[0]?.url ?? "").pathname, "/api/v1/openapi.yaml");
		const json = await run({
			argv: ["openapi", "--format", "json"],
			responses: [{ status: 200, text: "{\"openapi\":\"3.1.0\"}\n" }],
		});
		assert.equal(new URL(json.calls[0]?.url ?? "").pathname, "/api/v1/openapi.json");
	});

	it("turns a 204 into ok JSON", async () => {
		const result = await run({
			argv: ["webhooks", "delete", "oswhk_1", "--yes", "--json"],
			responses: [{ status: 204 }],
		});
		assert.equal(result.code, 0);
		assert.equal(result.stdout, "{\"ok\":true}\n");
		assert.equal(result.calls[0]?.method, "DELETE");
		assert.equal(result.calls[0]?.body, undefined);
	});
});
