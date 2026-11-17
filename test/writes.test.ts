import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { run } from "./helpers.ts";

describe("writes", () => {
	const gated = [
		["sources", "retry-syncs", "4"],
		["blocklists", "resync", "8"],
		["webhooks", "delete", "oswhk_1"],
		["webhooks", "rotate-secret", "oswhk_1"],
	];

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

	it("retries one sync without --yes", async () => {
		const result = await run({
			argv: ["syncs", "retry", "9"],
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
