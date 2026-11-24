import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { header, run } from "./helpers.ts";

describe("requests", () => {
	it("encodes string ids and sends bearer auth", async () => {
		const result = await run({
			argv: ["webhooks", "get", "oswhk_a/b"],
			responses: [{ status: 200, body: { id: "oswhk_a/b" } }],
		});
		assert.equal(result.code, 0);
		const url = new URL(result.calls[0]?.url ?? "");
		assert.equal(url.pathname, "/api/v1/webhooks/oswhk_a%2Fb");
		assert.equal(header(result.calls[0]?.headers ?? {}, "authorization"), "Bearer osapi_test_secret_value");
		assert.match(header(result.calls[0]?.headers ?? {}, "user-agent") ?? "", /^outboundsync-cli\//);
		assert.equal(header(result.calls[0]?.headers ?? {}, "content-type"), undefined);
	});

	it("sends repeated profileUrl params and one email", async () => {
		const result = await run({
			argv: ["contacts", "outreach", "--email", "ada@example.com", "--profile-url", "linkedin.com/in/a", "--profile-url", "example.com/in/b"],
			responses: [{ status: 200, body: { found: false } }],
		});
		assert.equal(result.code, 0);
		const params = new URL(result.calls[0]?.url ?? "").searchParams;
		assert.equal(params.get("email"), "ada@example.com");
		assert.deepEqual(params.getAll("profileUrl"), ["linkedin.com/in/a", "example.com/in/b"]);
	});

	it("rejects a non-positive integer before fetch", async () => {
		const result = await run({ argv: ["syncs", "get", "0"] });
		assert.equal(result.code, 1);
		assert.equal(result.calls.length, 0);
		assert.match(result.stderr, /positive integer/);
	});

	it("builds a webhook create body", async () => {
		const result = await run({
			argv: ["webhooks", "create", "--url", "https://example.com/hook", "--event", "sync.failed", "--event", "sync.succeeded", "--yes"],
			responses: [{ status: 201, body: { id: "oswhk_1", secret: "oswhsec_once" } }],
		});
		assert.equal(result.code, 0);
		assert.equal(result.calls[0]?.method, "POST");
		assert.deepEqual(result.calls[0]?.body, {
			url: "https://example.com/hook",
			enabledEvents: ["sync.failed", "sync.succeeded"],
		});
		assert.equal(header(result.calls[0]?.headers ?? {}, "content-type"), "application/json");
		assert.match(result.stdout, /oswhsec_once/);
		assert.match(result.stderr, /Signing secret shown once/);
	});

	it("sends isActive false and requires a field on update", async () => {
		const missing = await run({ argv: ["webhooks", "update", "oswhk_1", "--yes"] });
		assert.equal(missing.code, 1);
		assert.equal(missing.calls.length, 0);
		const result = await run({
			argv: ["webhooks", "update", "oswhk_1", "--active", "false", "--yes"],
			responses: [{ status: 200, body: { id: "oswhk_1", isActive: false } }],
		});
		assert.equal(result.code, 0);
		assert.equal(result.calls[0]?.method, "PATCH");
		assert.deepEqual(result.calls[0]?.body, { isActive: false });
	});

	it("requires --url on create", async () => {
		const result = await run({ argv: ["webhooks", "create", "--description", "CRM", "--yes"] });
		assert.equal(result.code, 1);
		assert.equal(result.calls.length, 0);
		assert.match(result.stderr, /webhooks create requires --url/);
	});

	it("rejects a non-https webhook url", async () => {
		const result = await run({ argv: ["webhooks", "create", "--url", "http://example.com/hook", "--yes"] });
		assert.equal(result.code, 1);
		assert.equal(result.calls.length, 0);
		assert.match(result.stderr, /https/);
	});

	it("sends a since range as from and to, not since", async () => {
		const result = await run({
			argv: ["syncs", "list", "--since", "24h", "--limit", "5"],
			responses: [{ status: 200, body: { data: [], hasMore: false, nextCursor: null } }],
		});
		const params = new URL(result.calls[0]?.url ?? "").searchParams;
		assert.equal(params.get("since"), null);
		assert.equal(params.get("from"), "2026-08-12T12:00:00.000Z");
		assert.equal(params.get("to"), "2026-08-13T12:00:00.000Z");
		assert.equal(params.get("limit"), "5");
	});

	it("omits limit unless it was passed and caps it", async () => {
		const listed = await run({
			argv: ["syncs", "list", "--since", "24h"],
			responses: [{ status: 200, body: { data: [], hasMore: false, nextCursor: null } }],
		});
		assert.equal(new URL(listed.calls[0]?.url ?? "").searchParams.get("limit"), null);
		const tooBig = await run({ argv: ["syncs", "list", "--since", "24h", "--limit", "501"] });
		assert.equal(tooBig.code, 1);
		assert.equal(tooBig.calls.length, 0);
		const events = await run({ argv: ["events", "list", "--limit", "101"] });
		assert.equal(events.code, 1);
		assert.equal(events.calls.length, 0);
	});

	it("renames a workspace and rejects a name over 80 characters", async () => {
		const result = await run({
			argv: ["workspace", "update", "--name", "North Studio", "--yes"],
			responses: [{ status: 200, body: { id: "ws_abc", name: "North Studio", role: "OWNER", permissions: [] } }],
		});
		assert.equal(result.code, 0);
		assert.equal(result.calls[0]?.method, "PATCH");
		assert.equal(new URL(result.calls[0]?.url ?? "").pathname, "/api/v1/workspace");
		assert.deepEqual(result.calls[0]?.body, { name: "North Studio" });
		const tooLong = await run({ argv: ["workspace", "update", "--name", "n".repeat(81), "--yes"] });
		assert.equal(tooLong.code, 1);
		assert.equal(tooLong.calls.length, 0);
		assert.match(tooLong.stderr, /80 characters/);
	});

	it("creates a domain and patches discoverable or auto-join", async () => {
		const created = await run({
			argv: ["workspace", "domains", "create", "--domain", "acme.com", "--yes"],
			responses: [{ status: 201, body: { domain: "acme.com", verified: false, discoverable: false, autoJoinEnabled: false } }],
		});
		assert.equal(created.code, 0);
		assert.equal(created.calls[0]?.method, "POST");
		assert.equal(new URL(created.calls[0]?.url ?? "").pathname, "/api/v1/workspace/domains");
		assert.deepEqual(created.calls[0]?.body, { domain: "acme.com" });
		const missing = await run({ argv: ["workspace", "domains", "update", "acme.com", "--yes"] });
		assert.equal(missing.code, 1);
		assert.equal(missing.calls.length, 0);
		const updated = await run({
			argv: ["workspace", "domains", "update", "acme.com", "--discoverable", "true", "--auto-join-enabled", "false", "--yes"],
			responses: [{ status: 200, body: { domain: "acme.com", verified: true, discoverable: true, autoJoinEnabled: false } }],
		});
		assert.equal(updated.code, 0);
		assert.equal(updated.calls[0]?.method, "PATCH");
		assert.equal(new URL(updated.calls[0]?.url ?? "").pathname, "/api/v1/workspace/domains/acme.com");
		assert.deepEqual(updated.calls[0]?.body, { discoverable: true, autoJoinEnabled: false });
	});

	it("lists invitations by status and invites with an optional role", async () => {
		const listed = await run({
			argv: ["workspace", "invitations", "--status", "pending"],
			responses: [{ status: 200, body: { invitations: [] } }],
		});
		assert.equal(listed.code, 0);
		assert.equal(listed.calls[0]?.method, "GET");
		assert.equal(new URL(listed.calls[0]?.url ?? "").pathname, "/api/v1/workspace/invitations");
		assert.equal(new URL(listed.calls[0]?.url ?? "").searchParams.get("status"), "pending");
		const invited = await run({
			argv: ["workspace", "invitations", "create", "--email", "teammate@acme.com", "--role", "ADMIN", "--yes"],
			responses: [{ status: 201, body: { id: "wsi_1", email: "teammate@acme.com", role: "ADMIN", resent: false } }],
		});
		assert.equal(invited.calls[0]?.method, "POST");
		assert.deepEqual(invited.calls[0]?.body, { email: "teammate@acme.com", role: "ADMIN" });
		const omitted = await run({
			argv: ["workspace", "invitations", "create", "--email", "teammate@acme.com", "--yes"],
			responses: [{ status: 201, body: { id: "wsi_1", email: "teammate@acme.com", role: "MEMBER", resent: false } }],
		});
		assert.deepEqual(omitted.calls[0]?.body, { email: "teammate@acme.com" });
	});

	it("encodes a member email in the path and redacts it from errors", async () => {
		const email = "teammate@acme.com";
		const updated = await run({
			argv: ["workspace", "members", "update", email, "--role", "MEMBER", "--yes"],
			responses: [{ status: 200, body: { email, role: "MEMBER" } }],
		});
		assert.equal(updated.code, 0);
		assert.equal(updated.calls[0]?.method, "PATCH");
		assert.equal(new URL(updated.calls[0]?.url ?? "").pathname, "/api/v1/workspace/members/teammate%40acme.com");
		assert.deepEqual(updated.calls[0]?.body, { role: "MEMBER" });
		const failed = await run({
			argv: ["workspace", "members", "delete", email, "--yes"],
			responses: [{ status: 404, body: { code: "MEMBER_NOT_FOUND", message: `missing ${email}` } }],
		});
		assert.equal(failed.code, 6);
		assert.equal(failed.calls[0]?.method, "DELETE");
		assert.equal(new URL(failed.calls[0]?.url ?? "").pathname, "/api/v1/workspace/members/teammate%40acme.com");
		assert.doesNotMatch(failed.stderr, /teammate@acme.com/);
		assert.doesNotMatch(failed.stderr, /teammate%40acme.com/);
	});

	it("sends delivered and webhook status as strings", async () => {
		const events = await run({
			argv: ["events", "list", "--type", "sync.failed", "--delivered", "false"],
			responses: [{ status: 200, body: { data: [], hasMore: false, nextCursor: null } }],
		});
		const params = new URL(events.calls[0]?.url ?? "").searchParams;
		assert.deepEqual(params.getAll("type"), ["sync.failed"]);
		assert.equal(params.get("delivered"), "false");
		const deliveries = await run({
			argv: ["webhooks", "deliveries", "oswhk_1", "--status", "DEAD"],
			responses: [{ status: 200, body: { data: [], hasMore: false, nextCursor: null } }],
		});
		assert.equal(new URL(deliveries.calls[0]?.url ?? "").searchParams.get("status"), "DEAD");
	});
});
