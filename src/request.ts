import { resolveDateRange } from "./dates";
import { flagString, flagStrings, type FlagMap } from "./parse";
import { flagsFor, limitMax, type CommandSpec, type FlagSpec } from "./registry";
import { UsageError } from "./usage";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface BuiltRequest {
	method: CommandSpec["method"];
	path: string;
	query: Record<string, string | string[]>;
	body?: Record<string, unknown>;
	pii: string[];
}

export interface OutreachInput {
	email?: string;
	profileUrl?: string[];
}

const SKIPPED = new Set(["from", "to", "since", "cursor", "all", "yes", "max-pages", "file", "format"]);

export function buildRequest(
	command: CommandSpec,
	args: readonly string[],
	flags: FlagMap,
	now: Date,
	cursor?: string,
): BuiltRequest {
	if (args.length !== command.args.length) {
		throw new UsageError(`expected ${command.args.length} argument(s) for ${command.words.join(" ")}`);
	}
	let path = command.path;
	if (command.id === "openapi") {
		const format = flagString(flags, "format") ?? "yaml";
		assertChoice("format", format, ["yaml", "json"]);
		path = format === "json" ? "/openapi.json" : "/openapi.yaml";
	}
	command.args.forEach((arg, index) => {
		const value = args[index] ?? "";
		if (arg.kind === "integer") assertPositiveInteger(value, `<${arg.name}>`);
		else if (value.trim() === "") throw new UsageError(`<${arg.name}> is required`);
		// encodeURIComponent leaves "." and ".." alone, and URL parsing would resolve them to a
		// different route, so a write could land on another endpoint.
		else if (value === "." || value === "..") throw new UsageError(`<${arg.name}> is not a valid id`);
		path = path.replaceAll(`{${arg.param}}`, encodeURIComponent(value));
	});

	const query: Record<string, string | string[]> = {};
	const pii: string[] = [];
	if (command.dateRange === "required") {
		const range = resolveDateRange(
			{
				from: flagString(flags, "from"),
				to: flagString(flags, "to"),
				since: flagString(flags, "since"),
			},
			now,
		);
		query.from = range.from;
		query.to = range.to;
	}
	if (cursor !== undefined) {
		if (cursor) query.cursor = cursor;
	} else {
		const fromFlag = flagString(flags, "cursor");
		if (fromFlag) query.cursor = fromFlag;
	}

	const body: Record<string, unknown> = {};
	let bodyFields = 0;
	for (const spec of flagsFor(command)) {
		if (SKIPPED.has(spec.name)) continue;
		if (spec.body) {
			bodyFields += writeBody(spec, flags, body);
			continue;
		}
		if (!spec.query) continue;
		const value = readQuery(spec, flags, command);
		if (value === undefined) continue;
		query[spec.query] = value;
		if (spec.name === "email" && typeof value === "string") pii.push(value);
		if (spec.name === "profile-url" && Array.isArray(value)) pii.push(...value);
	}

	if (command.id === "contacts.outreach") {
		const file = flagString(flags, "file");
		const email = typeof query.email === "string" ? query.email : undefined;
		const profiles = Array.isArray(query.profileUrl) ? query.profileUrl : [];
		if (file !== undefined && (email !== undefined || profiles.length > 0)) {
			throw new UsageError("--file cannot be combined with --email or --profile-url");
		}
		if (file === undefined && email === undefined && profiles.length === 0) {
			throw new UsageError("pass --email, --profile-url, or --file");
		}
		if (email !== undefined && !EMAIL_RE.test(email)) throw new UsageError("invalid email");
		if (profiles.length > 5) throw new UsageError("at most 5 profile URLs");
	}
	for (const spec of flagsFor(command)) {
		if (!spec.required || SKIPPED.has(spec.name)) continue;
		const sent = spec.body ? body[spec.body] : spec.query ? query[spec.query] : undefined;
		if (sent === undefined) throw new UsageError(`${command.words.join(" ")} requires --${spec.name}`);
	}
	if (command.id === "webhooks.update" && bodyFields === 0) {
		throw new UsageError("webhooks update requires --url, --description, --event, or --active");
	}

	return {
		method: command.method,
		path,
		query,
		body: bodyFields > 0 ? body : undefined,
		pii,
	};
}

export function buildOutreachQuery(input: OutreachInput): {
	query: Record<string, string | string[]>;
	pii: string[];
} {
	const query: Record<string, string | string[]> = {};
	const pii: string[] = [];
	if (input.email !== undefined) {
		if (!EMAIL_RE.test(input.email)) throw new UsageError("invalid email");
		query.email = input.email;
		pii.push(input.email);
	}
	if (input.profileUrl && input.profileUrl.length > 0) {
		if (input.profileUrl.length > 5) throw new UsageError("at most 5 profile URLs");
		query.profileUrl = [...input.profileUrl];
		pii.push(...input.profileUrl);
	}
	if (!query.email && !query.profileUrl) {
		throw new UsageError("pass --email, --profile-url, or --file");
	}
	return { query, pii };
}

function writeBody(spec: FlagSpec, flags: FlagMap, body: Record<string, unknown>): number {
	const field = spec.body;
	if (!field) return 0;
	if (spec.repeatable) {
		const values = flagStrings(flags, spec.name);
		if (values.length === 0) return 0;
		body[field] = values;
		return values.length;
	}
	const value = flagString(flags, spec.name);
	if (value === undefined) return 0;
	if (spec.values) assertChoice(spec.name, value, spec.values);
	if (spec.bodyBoolean) {
		body[field] = value === "true";
		return 1;
	}
	if (field === "url" && !isHttpsUrl(value)) {
		throw new UsageError("--url must be an https URL");
	}
	if (field === "url" && value.length > 2048) {
		throw new UsageError("--url must be 2048 characters or fewer");
	}
	if (field === "description" && value.length > 500) {
		throw new UsageError("--description must be 500 characters or fewer");
	}
	body[field] = value;
	return 1;
}

function readQuery(spec: FlagSpec, flags: FlagMap, command: CommandSpec): string | string[] | undefined {
	if (spec.repeatable) {
		const values = flagStrings(flags, spec.name);
		if (values.length === 0) return undefined;
		if (spec.values) {
			for (const value of values) assertChoice(spec.name, value, spec.values);
		}
		return values;
	}
	const value = flagString(flags, spec.name);
	if (value === undefined) return undefined;
	if (spec.values) assertChoice(spec.name, value, spec.values);
	if (spec.integer || spec.name === "limit") assertPositiveInteger(value, `--${spec.name}`);
	const max = spec.name === "limit" ? limitMax(command) : undefined;
	if (max !== undefined && Number(value) > max) {
		throw new UsageError(`--limit must be 1..${max}`);
	}
	return value;
}

export function assertPositiveInteger(value: string, label: string): void {
	if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) {
		throw new UsageError(`${label} must be a positive integer`);
	}
}

function assertChoice(name: string, value: string, values: readonly string[]): void {
	if (!values.includes(value)) {
		throw new UsageError(`--${name} must be ${values.join("|")}`);
	}
}

function isHttpsUrl(value: string): boolean {
	try {
		return new URL(value).protocol === "https:";
	} catch {
		return false;
	}
}
