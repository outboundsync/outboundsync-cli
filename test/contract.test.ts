import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { REGISTRY } from "../dist/outboundsync.js";

const HTTP = new Set(["get", "post", "put", "patch", "delete", "options", "head", "trace"]);
const ALLOW = new Set(["GET /health/live", "GET /health/ready"]);

const ROOT = new URL("../", import.meta.url);
const SNAPSHOT = new URL("api-sync/openapi.snapshot.json", ROOT);
// Legacy hand-kept copy of the spec. Used only until the first "API sync" PR
// adds the snapshot; it will be deleted after that.
const FIXTURE = new URL("fixtures/v1.yaml", import.meta.url);

/**
 * The spec to check against: API_SYNC_SPEC (set by the API sync workflow while
 * its agent works against the live spec), then the synced snapshot, then the
 * legacy YAML fixture.
 */
function loadSpec(): { source: string; doc: { paths: Record<string, Record<string, unknown>> } } {
	const override = process.env.API_SYNC_SPEC;
	const file = override ? new URL(override, ROOT) : existsSync(SNAPSHOT) ? SNAPSHOT : FIXTURE;
	const text = readFileSync(file, "utf8");
	const doc = file === FIXTURE ? parse(text) : JSON.parse(text);
	return { source: fileURLToPath(file), doc };
}

describe("openapi contract", () => {
	it("covers every v1 operation except the two health routes", () => {
		const { source, doc } = loadSpec();
		const specRoutes = new Set<string>();
		for (const [path, item] of Object.entries(doc.paths)) {
			for (const method of Object.keys(item)) {
				if (!HTTP.has(method)) continue;
				specRoutes.add(`${method.toUpperCase()} ${path}`);
			}
		}
		for (const allowed of ALLOW) {
			assert.ok(specRoutes.has(allowed), `allowlist route missing from ${source}: ${allowed}`);
		}

		const registryRoutes = new Set<string>();
		for (const command of REGISTRY) {
			if (command.id === "openapi") {
				assert.equal(command.method, "GET");
				assert.equal(command.path, "/openapi.yaml");
				assert.equal(command.auth, false);
				registryRoutes.add("GET /api/v1/openapi.yaml");
				registryRoutes.add("GET /api/v1/openapi.json");
				continue;
			}
			registryRoutes.add(`${command.method} /api/v1${command.path}`);
		}

		const missing: string[] = [];
		for (const route of specRoutes) {
			if (ALLOW.has(route) || registryRoutes.has(route)) continue;
			missing.push(route);
		}
		const extra: string[] = [];
		for (const route of registryRoutes) {
			if (!specRoutes.has(route)) extra.push(route);
		}
		assert.deepEqual(missing, [], `spec routes in ${source} missing from the registry: ${missing.join(", ")}`);
		assert.deepEqual(extra, [], `registry routes missing from ${source}: ${extra.join(", ")}`);
	});
});
