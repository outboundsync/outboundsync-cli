import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { REGISTRY } from '../dist/outboundsync.js';
import {
	DISCOVERY_OPERATIONS,
	checkCoverage,
	listOperations,
	main,
	normalizePath,
	parseRegistry,
	resolveSpecPath,
} from '../scripts/check-api-coverage.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** A spec with the discovery routes, the openapi documents and the given operations. */
function spec(extraOps = []) {
	const paths = {};
	const add = (method, p, operationId = `${method}${p}`) => {
		paths[p] ??= {};
		paths[p][method.toLowerCase()] = { operationId };
	};
	for (const key of DISCOVERY_OPERATIONS) add(...key.split(' '));
	add('GET', '/api/v1/openapi.yaml');
	add('GET', '/api/v1/openapi.json');
	for (const [method, p] of extraOps) add(method, p);
	return { openapi: '3.1.0', paths };
}

function registry(entries) {
	return `export const REGISTRY = [
${entries.join('\n')}
] as const;

export type CommandId = (typeof REGISTRY)[number]["id"];`;
}

const OPENAPI = `	cmd({
		id: "openapi",
		words: ["openapi"],
		method: "GET",
		path: "/openapi.yaml",
		args: [],
		flags: [{ name: "format", help: "Document format.", values: ["yaml", "json"] }],
		scope: "none",
		auth: false,
		help: "Print the OpenAPI document.",
	}),`;
const SYNCS_GET = `	cmd({
		id: "syncs.get",
		words: ["syncs", "get"],
		method: "GET",
		path: "/syncs/{id}",
		args: [integerArg("id")],
		flags: [],
		scope: "read",
		auth: true,
		help: "Show one sync.",
	}),`;
const SYNCS_RETRY = `	cmd({
		id: "syncs.retry",
		words: ["syncs", "retry"],
		method: "POST",
		path: "/syncs/{id}/retry",
		args: [integerArg("id")],
		flags: [],
		scope: "write",
		auth: true,
		confirm:
			"Re-queues this failed sync to the CRM. Re-run with --yes.",
		help: "Retry one failed sync.",
	}),`;

const OPS = [
	['GET', '/api/v1/syncs/{syncId}'],
	['POST', '/api/v1/syncs/{syncId}/retry'],
];

describe('check-api-coverage', () => {
	it('normalizes path parameter names', () => {
		assert.equal(normalizePath('/api/v1/syncs/{syncId}/retry'), '/api/v1/syncs/{}/retry');
		assert.equal(normalizePath('/api/v1/syncs/{id}/retry'), '/api/v1/syncs/{}/retry');
	});

	it('classifies the health routes as discovery and everything else as in scope', () => {
		const kinds = Object.fromEntries(listOperations(spec(OPS)).map((op) => [`${op.method} ${op.path}`, op.kind]));
		assert.equal(kinds['GET /health/live'], 'discovery');
		assert.equal(kinds['GET /health/ready'], 'discovery');
		assert.equal(kinds['GET /api/v1/openapi.json'], 'in-scope');
		assert.equal(kinds['POST /api/v1/syncs/{syncId}/retry'], 'in-scope');
	});

	it('reads id, method, path, scope and confirm from registry entries', () => {
		const { commands, problems } = parseRegistry(registry([OPENAPI, SYNCS_GET, SYNCS_RETRY]));
		assert.deepEqual(problems, []);
		assert.deepEqual(commands, [
			{ id: 'openapi', method: 'GET', path: '/openapi.yaml', scope: 'none', confirm: false },
			{ id: 'syncs.get', method: 'GET', path: '/syncs/{id}', scope: 'read', confirm: false },
			{ id: 'syncs.retry', method: 'POST', path: '/syncs/{id}/retry', scope: 'write', confirm: true },
		]);
	});

	it('passes when every operation has a command and every write has confirm', () => {
		const result = checkCoverage({ spec: spec(OPS), registrySource: registry([OPENAPI, SYNCS_GET, SYNCS_RETRY]) });
		assert.deepEqual(result.errors, []);
		assert.equal(result.inScope, 4);
		assert.equal(result.commands, 3);
	});

	it('fails on an operation with no command', () => {
		const { errors } = checkCoverage({
			spec: spec([...OPS, ['DELETE', '/api/v1/syncs/{syncId}']]),
			registrySource: registry([OPENAPI, SYNCS_GET, SYNCS_RETRY]),
		});
		assert.equal(errors.length, 1);
		assert.match(errors[0], /missing command for DELETE \/api\/v1\/syncs\/\{syncId\}/);
	});

	it('fails on a command whose route is not in the spec', () => {
		const { errors } = checkCoverage({
			spec: spec([OPS[0]]),
			registrySource: registry([OPENAPI, SYNCS_GET, SYNCS_RETRY]),
		});
		assert.equal(errors.length, 1);
		assert.match(errors[0], /"syncs\.retry" targets POST \/api\/v1\/syncs\/\{id\}\/retry, which is not in the OpenAPI spec/);
	});

	it('fails on a write command with no confirm', () => {
		const ungated = SYNCS_RETRY.replace(/\t\tconfirm:\n.*\n/, '');
		assert.doesNotMatch(ungated, /confirm/);
		const { errors } = checkCoverage({ spec: spec(OPS), registrySource: registry([OPENAPI, SYNCS_GET, ungated]) });
		assert.equal(errors.length, 1);
		assert.match(errors[0], /"syncs\.retry" \(POST \/syncs\/\{id\}\/retry\) writes but has no confirm/);
	});

	it('treats an empty confirm as missing', () => {
		const empty = SYNCS_RETRY.replace(/confirm:\n.*\n/, 'confirm: "",\n');
		const { errors } = checkCoverage({ spec: spec(OPS), registrySource: registry([OPENAPI, SYNCS_GET, empty]) });
		assert.equal(errors.length, 1);
		assert.match(errors[0], /has no confirm/);
	});

	it('lets the openapi command cover both document formats, and needs both in the spec', () => {
		const noJson = spec(OPS);
		delete noJson.paths['/api/v1/openapi.json'];
		const { errors } = checkCoverage({ spec: noJson, registrySource: registry([OPENAPI, SYNCS_GET, SYNCS_RETRY]) });
		assert.equal(errors.length, 1);
		assert.match(errors[0], /"openapi" targets GET \/api\/v1\/openapi\.json, which is not in the OpenAPI spec/);

		const missing = checkCoverage({ spec: spec(OPS), registrySource: registry([SYNCS_GET, SYNCS_RETRY]) });
		assert.deepEqual(
			missing.errors.map((e) => e.replace(/ \(.*$/, '')),
			['missing command for GET /api/v1/openapi.yaml', 'missing command for GET /api/v1/openapi.json'],
		);
	});

	it('enforces reviewed exclusions both ways', () => {
		const exclusions = { 'POST /api/v1/syncs/{syncId}/retry': 'Not in the CLI (test).', 'GET /api/v1/gone': 'Stale.' };
		const { errors } = checkCoverage({
			spec: spec(OPS),
			registrySource: registry([OPENAPI, SYNCS_GET, SYNCS_RETRY]),
			exclusions,
		});
		assert.equal(errors.length, 2);
		assert.match(errors[0], /"syncs\.retry" targets excluded operation/);
		assert.match(errors[1], /exclusion "GET \/api\/v1\/gone" .* is not in the OpenAPI spec/);
	});

	it('reports a registry entry it cannot read', () => {
		const computed = SYNCS_GET.replace('path: "/syncs/{id}"', 'path: SYNC_PATH');
		const { errors } = checkCoverage({ spec: spec(OPS), registrySource: registry([OPENAPI, computed, SYNCS_RETRY]) });
		assert.ok(errors.some((e) => /registry entry #2 \("syncs\.get"\): cannot read/.test(e)));
	});

	it('reads the real registry exactly as the built CLI sees it', () => {
		const { commands, problems } = parseRegistry(readFileSync(path.join(ROOT, 'src/registry.ts'), 'utf8'));
		assert.deepEqual(problems, []);
		assert.deepEqual(
			commands,
			REGISTRY.map((c) => ({ id: c.id, method: c.method, path: c.path, scope: c.scope, confirm: Boolean(c.confirm) })),
		);
	});

	it('passes for the real registry against the current spec', () => {
		// API_SYNC_SPEC, then the synced snapshot.
		const specPath = resolveSpecPath([], process.env, ROOT);
		assert.ok(existsSync(specPath), `missing ${specPath}; run the API sync workflow`);
		const doc = JSON.parse(readFileSync(specPath, 'utf8'));
		const { errors } = checkCoverage({
			spec: doc,
			registrySource: readFileSync(path.join(ROOT, 'src/registry.ts'), 'utf8'),
		});
		assert.deepEqual(errors, []);
	});

	it('prefers --snapshot, then API_SYNC_SPEC, then the snapshot path', () => {
		assert.equal(resolveSpecPath(['--snapshot', 'a.json'], { API_SYNC_SPEC: 'b.json' }, '/r'), '/r/a.json');
		assert.equal(resolveSpecPath([], { API_SYNC_SPEC: 'b.json' }, '/r'), '/r/b.json');
		assert.equal(resolveSpecPath([], {}, '/r'), '/r/api-sync/openapi.snapshot.json');
	});

	it('skips with a notice when there is no snapshot, and checks one when there is', () => {
		const dir = mkdtempSync(path.join(tmpdir(), 'api-coverage-'));
		const logs = [];
		const original = console.log;
		console.log = (line) => logs.push(line);
		try {
			mkdirSync(path.join(dir, 'src'));
			writeFileSync(path.join(dir, 'src/registry.ts'), registry([OPENAPI, SYNCS_GET]));
			assert.equal(main([], dir, {}), 0);
			assert.match(logs.at(-1), /^::notice title=API coverage skipped::/);

			mkdirSync(path.join(dir, 'api-sync'));
			writeFileSync(path.join(dir, 'api-sync/openapi.snapshot.json'), JSON.stringify(spec(OPS)));
			assert.equal(main([], dir, {}), 1);
			assert.ok(logs.some((line) => /^::error::missing command for POST \/api\/v1\/syncs\/\{syncId\}\/retry/.test(line)));

			writeFileSync(path.join(dir, 'src/registry.ts'), registry([OPENAPI, SYNCS_GET, SYNCS_RETRY]));
			assert.equal(main([], dir, {}), 0);
			assert.match(logs.at(-1), /^API coverage ok: 4 in-scope operations/);
		} finally {
			console.log = original;
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
