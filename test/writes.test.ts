import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { REGISTRY } from "../dist/outboundsync.js";
import { run } from "./helpers.ts";

describe("writes", () => {
	const gated = [
		["sources", "retry-syncs", "4"],
		["syncs", "retry", "9"],
		["destinations", "replay", "3", "900"],
		["blocklists", "pause", "8"],
		["blocklists", "resync", "8"],
		["webhooks", "create", "--url", "https://example.com/hook"],
		["webhooks", "update", "oswhk_1", "--active", "false"],
		["webhooks", "delete", "oswhk_1"],
		["webhooks", "rotate-secret", "oswhk_1"],
		["webhooks", "test", "oswhk_1"],
		["webhooks", "replay", "oswhk_1", "oswhd_1"],
		["workspace", "update", "--name", "North Studio"],
		["workspace", "domains", "create", "--domain", "acme.com"],
		["workspace", "domains", "update", "acme.com", "--discoverable", "true"],
		["workspace", "domains", "delete", "acme.com"],
		["workspace", "invitations", "create", "--email", "teammate@acme.com"],
		["workspace", "invitations", "delete", "wsi_0123456789abcdefghij"],
		["workspace", "members", "update", "teammate@acme.com", "--role", "ADMIN"],
		["workspace", "members", "delete", "teammate@acme.com"],
	];

	it("gates every write-scope command in the registry", () => {
		const writes = REGISTRY.filter((command) => command.scope === "write").map((command) => command.words.join(" "));
		const covered = gated.map((argv) => {
			const matches = REGISTRY.filter(
				(command) => command.scope === "write" && command.words.every((word, index) => argv[index] === word),
			).sort((left, right) => right.words.length - left.words.length);
			const command = matches[0];
			assert.ok(command, `no write command for ${argv.join(" ")}`);
			return command.words.join(" ");
		});
		assert.deepEqual([...writes].sort(), [...covered].sort());
		for (const command of REGISTRY) {
			if (command.scope === "write") assert.ok("confirm" in command && command.confirm, `${command.id} has no --yes gate`);
		}
	});

	for (const argv of gated) {
		it(`requires --yes for ${argv.join(" ")} and does not fetch`, async () => {
			const result = await run({ argv });
			assert.equal(result.code, 1);
			assert.equal(result.calls.length, 0);
			assert.match(result.stderr, /--yes/);
		});
	}

	it("fetches a gated command when --yes is present", async () => {
		const result = await run({
			argv: ["blocklists", "resync", "8", "--yes"],
			responses: [{ status: 200, body: { id: 8, status: "queued" } }],
		});
		assert.equal(result.code, 0);
		assert.equal(result.calls.length, 1);
		assert.equal(result.calls[0]?.method, "POST");
	});

	it("retries one sync with --yes", async () => {
		const result = await run({
			argv: ["syncs", "retry", "9", "--yes"],
			responses: [{ status: 201, body: { queued: true, syncId: 9 } }],
		});
		assert.equal(result.code, 0);
		assert.equal(result.calls.length, 1);
		assert.match(result.stdout, /"queued": true/);
	});

	it("prints a rotated secret once and hides it on errors", async () => {
		const ok = await run({
			argv: ["webhooks", "rotate-secret", "oswhk_1", "--yes"],
			responses: [{ status: 200, body: { id: "oswhk_1", secret: "oswhsec_newsecret" } }],
		});
		assert.match(ok.stdout, /oswhsec_newsecret/);
		assert.match(ok.stderr, /shown once/);
		const failed = await run({
			argv: ["webhooks", "rotate-secret", "oswhk_1", "--yes"],
			responses: [{ status: 400, body: { message: "leaked oswhsec_zzz" } }],
		});
		assert.equal(failed.code, 6);
		assert.doesNotMatch(failed.stdout, /oswhsec_zzz/);
		assert.doesNotMatch(failed.stderr, /oswhsec_zzz/);
		assert.match(failed.stderr, /\[redacted\]/);
	});

	it("redacts an echoed email from an outreach error", async () => {
		const email = "secret-person@example.com";
		const result = await run({
			argv: ["contacts", "outreach", "--email", email],
			responses: [{ status: 400, body: { message: `unknown ${email}` } }],
		});
		assert.equal(result.code, 6);
		assert.doesNotMatch(result.stderr, new RegExp(email.replace(".", "\\.")));
		assert.doesNotMatch(result.stderr, /\?email=/);
		assert.doesNotMatch(result.stdout, new RegExp(email.replace(".", "\\.")));
	});
});
