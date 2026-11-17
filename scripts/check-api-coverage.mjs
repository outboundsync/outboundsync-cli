#!/usr/bin/env node
// API coverage check: the CLI's commands must match the OutboundSync OpenAPI
// snapshot in api-sync/openapi.snapshot.json (written by the "API sync"
// workflow from https://app.outboundsync.com/api/v1/openapi.json).
//
// Commands are read statically from the REGISTRY table in src/registry.ts:
// every `cmd({ … })` entry's id, method, path (relative to /api/v1) and
// whether it has a `confirm` (the --yes gate). Nothing is built or run.
//
// Scope:
//   - Every `paths.*.<method>` in the spec is in scope, except the discovery
//     operations (GET /health/live, GET /health/ready) and the reviewed
//     EXCLUDED_OPERATIONS below (none today).
//   - The `openapi` command covers both GET /api/v1/openapi.yaml and
//     GET /api/v1/openapi.json (--format yaml|json).
//   - A new operation is in scope by default, so the sync agent adds a command
//     for it. Leaving one out of the CLI is a human decision: add it to
//     EXCLUDED_OPERATIONS with a reason.
//
// Checks:
//   1. every in-scope operation has a command (method + path);
//   2. every command targets an operation in the spec, and not a discovery or
//      excluded one;
//   3. every write command (any method but GET) has `confirm`, so it does
//      nothing without --yes;
//   4. every exclusion still names an operation in the spec.
// With no snapshot the check skips with a notice and exits 0.
//
// The spec read is, in order: --snapshot <file>, the API_SYNC_SPEC environment
// variable (set by the workflow while the agent works against the live spec),
// then api-sync/openapi.snapshot.json.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const DEFAULT_SNAPSHOT = 'api-sync/openapi.snapshot.json';
export const DEFAULT_REGISTRY = 'src/registry.ts';

/** Registry paths are relative to the API base URL, which includes this prefix. */
export const API_PREFIX = '/api/v1';

const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'patch', 'head', 'options', 'trace'];

/** Discovery operations: not API surface, never commands. */
export const DISCOVERY_OPERATIONS = ['GET /health/live', 'GET /health/ready'];

/** The `openapi` command fetches the spec itself, in either format. */
export const OPENAPI_COMMAND_ID = 'openapi';
export const OPENAPI_OPERATIONS = ['GET /api/v1/openapi.yaml', 'GET /api/v1/openapi.json'];

/**
 * Operations this CLI deliberately does not wrap. Keyed by `METHOD path`
 * (spec form). Every entry needs a reason; remove the entry when a command is added.
 */
export const EXCLUDED_OPERATIONS = {};

/** `/syncs/{id}` and `/syncs/{syncId}` both become `/syncs/{}`. */
export function normalizePath(p) {
	return p.replace(/\{[^}]*\}/g, '{}');
}

export function opKey(method, p) {
	return `${method.toUpperCase()} ${p}`;
}

/** Every operation in the spec, classified. */
export function listOperations(spec, exclusions = EXCLUDED_OPERATIONS) {
	if (!spec || typeof spec !== 'object' || typeof spec.openapi !== 'string' || !spec.paths) {
		throw new Error('snapshot is not an OpenAPI document (missing .openapi or .paths)');
	}
	const ops = [];
	for (const [p, item] of Object.entries(spec.paths)) {
		for (const method of HTTP_METHODS) {
			const op = item?.[method];
			if (!op) continue;
			const key = opKey(method, p);
			let kind = 'in-scope';
			if (DISCOVERY_OPERATIONS.includes(key)) kind = 'discovery';
			else if (Object.hasOwn(exclusions, key)) kind = 'excluded';
			ops.push({ method: method.toUpperCase(), path: p, operationId: op.operationId ?? null, kind });
		}
	}
	return ops;
}

function field(block, name) {
	const m = block.match(new RegExp(`^\\s*${name}:\\s*(["'\`])([^"'\`]*)\\1`, 'm'));
	return m ? m[2] : null;
}

/**
 * Commands from `export const REGISTRY = [ cmd({ … }), … ] as const;`. Each
 * entry must spell `id`, `method`, `path` and `scope` as string literals.
 */
export function parseRegistry(source) {
	const start = source.indexOf('export const REGISTRY = [');
	if (start < 0) throw new Error('src/registry.ts: export const REGISTRY = [ not found');
	const end = source.indexOf('] as const;', start);
	if (end < 0) throw new Error('src/registry.ts: REGISTRY does not end with "] as const;"');
	const blocks = source.slice(start, end).split(/\bcmd\(\{/).slice(1);
	const commands = [];
	const problems = [];
	blocks.forEach((block, index) => {
		const id = field(block, 'id');
		const method = field(block, 'method');
		const p = field(block, 'path');
		const scope = field(block, 'scope');
		if (!id || !method || !p || !scope) {
			problems.push(
				`registry entry #${index + 1}${id ? ` ("${id}")` : ''}: cannot read its id, method, path and scope. Write them as string literals in the cmd({ … }) entry.`,
			);
			return;
		}
		const confirm = /^\s*confirm:\s*(["'`])(?!\1)/m.test(block);
		commands.push({ id, method: method.toUpperCase(), path: p, scope, confirm });
	});
	return { commands, problems };
}

/** The spec operations a command calls. */
export function commandRoutes(command) {
	if (command.id === OPENAPI_COMMAND_ID) return OPENAPI_OPERATIONS;
	return [opKey(command.method, `${API_PREFIX}${command.path}`)];
}

export function checkCoverage({ spec, registrySource, exclusions = EXCLUDED_OPERATIONS }) {
	const errors = [];
	const ops = listOperations(spec, exclusions);
	const byKey = new Map(ops.map((op) => [opKey(op.method, normalizePath(op.path)), op]));
	const { commands, problems } = parseRegistry(registrySource);
	errors.push(...problems);

	const covered = new Set();
	for (const cmd of commands) {
		if (cmd.id === OPENAPI_COMMAND_ID && (cmd.method !== 'GET' || cmd.path !== '/openapi.yaml')) {
			errors.push(`command "${cmd.id}" must stay GET /openapi.yaml (with --format json for /openapi.json).`);
		}
		if (cmd.method !== 'GET' && !cmd.confirm) {
			errors.push(
				`command "${cmd.id}" (${cmd.method} ${cmd.path}) writes but has no confirm: every write command needs a confirm message so it does nothing without --yes.`,
			);
		}
		for (const route of commandRoutes(cmd)) {
			const [method, p] = route.split(' ');
			const key = opKey(method, normalizePath(p));
			const op = byKey.get(key);
			if (!op) {
				errors.push(`command "${cmd.id}" targets ${route}, which is not in the OpenAPI spec.`);
				continue;
			}
			covered.add(key);
			if (op.kind === 'discovery') {
				errors.push(`command "${cmd.id}" targets ${route}, a discovery operation that is not API surface.`);
			} else if (op.kind === 'excluded') {
				errors.push(
					`command "${cmd.id}" targets excluded operation ${route}. Remove the command, or remove the exclusion in scripts/check-api-coverage.mjs.`,
				);
			}
		}
	}

	const inScope = ops.filter((op) => op.kind === 'in-scope');
	for (const op of inScope) {
		if (covered.has(opKey(op.method, normalizePath(op.path)))) continue;
		errors.push(
			`missing command for ${opKey(op.method, op.path)}${op.operationId ? ` (${op.operationId})` : ''}: add a cmd({ … }) entry to src/registry.ts.`,
		);
	}

	const specKeys = new Set(ops.map((op) => opKey(op.method, op.path)));
	for (const key of Object.keys(exclusions)) {
		if (!specKeys.has(key)) {
			errors.push(`exclusion "${key}" in scripts/check-api-coverage.mjs is not in the OpenAPI spec; remove it.`);
		}
	}

	return { errors, inScope: inScope.length, commands: commands.length, operations: ops.length };
}

function readArg(argv, flag) {
	const i = argv.indexOf(flag);
	return i >= 0 && argv[i + 1] ? argv[i + 1] : null;
}

/** The spec file to check against: --snapshot, then API_SYNC_SPEC, then the snapshot. */
export function resolveSpecPath(argv = [], env = process.env, root = ROOT) {
	return path.resolve(root, readArg(argv, '--snapshot') || env.API_SYNC_SPEC || DEFAULT_SNAPSHOT);
}

export function main(argv = process.argv.slice(2), root = ROOT, env = process.env) {
	const specPath = resolveSpecPath(argv, env, root);
	if (!existsSync(specPath)) {
		console.log(
			`::notice title=API coverage skipped::No ${path.relative(root, specPath)} yet. The first "API sync" run adds it; until then the CLI is not checked against the OpenAPI spec.`,
		);
		return 0;
	}
	const spec = JSON.parse(readFileSync(specPath, 'utf8'));
	const registrySource = readFileSync(path.resolve(root, readArg(argv, '--registry') || DEFAULT_REGISTRY), 'utf8');
	const result = checkCoverage({ spec, registrySource });
	if (result.errors.length > 0) {
		for (const error of result.errors) console.log(`::error::${error}`);
		console.log(
			`API coverage failed: ${result.errors.length} problem(s). ${result.inScope} in-scope operations, ${result.commands} CLI commands.`,
		);
		return 1;
	}
	console.log(
		`API coverage ok: ${result.inScope} in-scope operations all have CLI commands; ${result.commands} commands all target the spec and every write needs --yes (${result.operations} operations in ${path.relative(root, specPath)}).`,
	);
	return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	try {
		process.exitCode = main();
	} catch (error) {
		console.log(`::error::API coverage check crashed: ${error instanceof Error ? error.message : String(error)}`);
		process.exitCode = 1;
	}
}
