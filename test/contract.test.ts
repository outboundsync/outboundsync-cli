import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { parse } from "yaml";
import { REGISTRY } from "../dist/outboundsync.js";

const HTTP = new Set(["get", "post", "put", "patch", "delete", "options", "head", "trace"]);
const ALLOW = new Set(["GET /health/live", "GET /health/ready"]);

describe("openapi contract", () => {
	it("covers every v1 operation except the two health routes", () => {
		const doc = parse(readFileSync(new URL("./fixtures/v1.yaml", import.meta.url), "utf8")) as {
			paths: Record<string, Record<string, unknown>>;
		};
		const specRoutes = new Set<string>();
		for (const [path, item] of Object.entries(doc.paths)) {
			for (const method of Object.keys(item)) {
				if (!HTTP.has(method)) continue;
				specRoutes.add(`${method.toUpperCase()} ${path}`);
			}
		}
		for (const allowed of ALLOW) {
			assert.ok(specRoutes.has(allowed), `allowlist route missing from spec: ${allowed}`);
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
		assert.deepEqual(missing, [], `spec routes missing from the registry: ${missing.join(", ")}`);
		assert.deepEqual(extra, [], `registry routes missing from the spec: ${extra.join(", ")}`);
	});
});
