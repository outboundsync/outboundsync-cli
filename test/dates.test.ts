import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseIsoTimestamp, resolveDateRange } from "../dist/outboundsync.js";

const NOW = new Date("2026-08-13T12:00:00.000Z");

describe("dates", () => {
	it("expands --since from a frozen clock", () => {
		assert.deepEqual(resolveDateRange({ since: "24h" }, NOW), {
			from: "2026-08-12T12:00:00.000Z",
			to: "2026-08-13T12:00:00.000Z",
		});
		assert.deepEqual(resolveDateRange({ since: "7d" }, NOW), {
			from: "2026-08-06T12:00:00.000Z",
			to: "2026-08-13T12:00:00.000Z",
		});
		assert.deepEqual(resolveDateRange({ since: "30d" }, NOW), {
			from: "2026-07-14T12:00:00.000Z",
			to: "2026-08-13T12:00:00.000Z",
		});
	});

	it("allows a span of exactly 31 days", () => {
		const range = resolveDateRange(
			{ from: "2026-01-01T00:00:00Z", to: "2026-02-01T00:00:00Z" },
			NOW,
		);
		assert.equal(range.from, "2026-01-01T00:00:00Z");
		assert.equal(range.to, "2026-02-01T00:00:00Z");
	});

	it("rejects one millisecond past 31 days", () => {
		assert.throws(
			() => resolveDateRange({ from: "2026-01-01T00:00:00.000Z", to: "2026-02-01T00:00:00.001Z" }, NOW),
			/maximum is 31/,
		);
	});

	it("rejects from after to", () => {
		assert.throws(
			() => resolveDateRange({ from: "2026-02-01T00:00:00Z", to: "2026-01-01T00:00:00Z" }, NOW),
			/`to` must be on or after `from`/,
		);
	});

	it("rejects a date-only value and a timestamp without an offset", () => {
		assert.throws(() => parseIsoTimestamp("2026-01-01"), /timezone offset/);
		assert.throws(() => parseIsoTimestamp("2026-01-01T00:00:00"), /timezone offset/);
		assert.throws(() => parseIsoTimestamp("2026-02-31T00:00:00Z"), /timezone offset/);
	});

	it("accepts an explicit zero offset", () => {
		assert.equal(parseIsoTimestamp("2026-01-01T00:00:00+00:00"), Date.parse("2026-01-01T00:00:00Z"));
	});

	it("rejects --since combined with --from", () => {
		assert.throws(
			() => resolveDateRange({ since: "24h", from: "2026-01-01T00:00:00Z" }, NOW),
			/--since cannot be combined/,
		);
	});
});
