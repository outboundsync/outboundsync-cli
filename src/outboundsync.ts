import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defaultSleep, apiRequest, type ApiResult } from "./client";
import { BASE_URL_ENV, DEFAULT_BASE_URL, EXIT, TOKEN_ENV, type ExitCode } from "./const";
import { ApiFailure, nonJsonMessage } from "./errors";
import { commandHelp, commandUsage, groupHelp, rootHelp } from "./help";
import { loadOutreachRows, MAX_INPUT_BYTES, readBoundedFile } from "./outreach-file";
import { humanSummary, readPage } from "./output";
import { maxPages, paceDelayMs } from "./paginate";
import { assertKnownFlags, flagBool, flagString, parseArgv, type FlagMap } from "./parse";
import { isRecord } from "./record";
import { REGISTRY, resolveCommand, type CommandSpec } from "./registry";
import { safeTerminalText } from "./terminal";
import { buildOutreachQuery, buildRequest, type BuiltRequest, type OutreachInput } from "./request";
import { UsageError } from "./usage";
import { getPackageVersion } from "./version";

export interface CliIo {
	argv: string[];
	env: NodeJS.ProcessEnv;
	stdout: (text: string) => void;
	stderr: (text: string) => void;
	fetch: typeof fetch;
	readFile?: (filePath: string) => Promise<string>;
	stdin?: string;
	now?: () => Date;
	sleep?: (ms: number) => Promise<void>;
}

export async function runCli(rawIo: CliIo): Promise<number> {
	// Every byte the CLI prints passes through here, so API-controlled text cannot drive the terminal.
	const io: CliIo = {
		...rawIo,
		stdout: (text) => rawIo.stdout(safeTerminalText(text)),
		stderr: (text) => rawIo.stderr(safeTerminalText(text)),
	};
	const secrets = collectSecrets(io);
	try {
		return await dispatch(io, secrets);
	} catch (error) {
		if (error instanceof ApiFailure) {
			writeFailure(io, error, secrets, [], false);
			return error.exitCode;
		}
		const message = error instanceof Error ? error.message : String(error);
		io.stderr(`${redact(message, secrets)}\n`);
		return EXIT.usage;
	}
}

async function dispatch(io: CliIo, secrets: string[]): Promise<number> {
	const parsed = parseArgv(io.argv);
	if (flagBool(parsed.flags, "version") || flagBool(parsed.flags, "V")) {
		io.stdout(`${getPackageVersion()}\n`);
		return EXIT.ok;
	}
	let positionals = parsed.positionals;
	let help = flagBool(parsed.flags, "help") || flagBool(parsed.flags, "h");
	if (positionals[0] === "help") {
		help = true;
		positionals = positionals.slice(1);
	}
	if (positionals.length === 0) {
		io.stdout(rootHelp());
		return EXIT.ok;
	}
	const resolved = resolveCommand(positionals);
	if (resolved.type === "unknown") {
		const head = positionals[0] ?? "";
		const group = REGISTRY.some((command) => command.words[0] === head);
		if (group) throw new UsageError(groupHelp([head]).trimEnd());
		throw new UsageError(`unknown command ${positionals.join(" ")}`);
	}
	if (resolved.type === "group") {
		const text = groupHelp(positionals);
		if (help) {
			io.stdout(text);
			return EXIT.ok;
		}
		throw new UsageError(text.trimEnd());
	}
	const command = resolved.command;
	if (help) {
		io.stdout(commandHelp(command));
		return EXIT.ok;
	}
	if (resolved.args.length !== command.args.length) {
		throw new UsageError(commandUsage(command));
	}
	assertKnownFlags(command, parsed.flags);
	if (flagString(parsed.flags, "max-pages") !== undefined && !flagBool(parsed.flags, "all")) {
		throw new UsageError("--max-pages requires --all");
	}
	if (command.confirm && !flagBool(parsed.flags, "yes")) {
		throw new UsageError(command.confirm);
	}
	const token = command.auth ? requireToken(parsed.flags, io.env) : undefined;
	const baseUrl = resolveBaseUrl(parsed.flags, io.env);
	const asJson = flagBool(parsed.flags, "json");
	if (command.id === "contacts.outreach" && flagString(parsed.flags, "file") !== undefined) {
		return runOutreachFile(io, command, parsed.flags, secrets, token, baseUrl, asJson);
	}
	const built = buildRequest(command, resolved.args, parsed.flags, clock(io), undefined);
	if (flagBool(parsed.flags, "all")) {
		return runPages(io, command, built, secrets, token, baseUrl, asJson, maxPages(flagString(parsed.flags, "max-pages")));
	}
	let result: ApiResult;
	try {
		result = await callApi(io, command, built, token, baseUrl, built.query);
	} catch (error) {
		if (error instanceof ApiFailure) {
			writeFailure(io, error, secrets, built.pii, asJson);
			return error.exitCode;
		}
		throw error;
	}
	if (brokenCursor(command, result.body)) {
		writeBody(io, result, secrets, asJson);
		io.stderr("page reported more results but no nextCursor\n");
		return EXIT.server;
	}
	writeSuccess(io, command, result, secrets, asJson);
	return EXIT.ok;
}

async function runPages(
	io: CliIo,
	command: CommandSpec,
	built: BuiltRequest,
	secrets: string[],
	token: string | undefined,
	baseUrl: string,
	asJson: boolean,
	cap: number,
): Promise<number> {
	let cursor: string | undefined;
	let total = 0;
	for (let page = 0; page < cap; page++) {
		const query = page === 0 ? built.query : replaceCursor(built.query, cursor);
		let result: ApiResult;
		try {
			result = await callApi(io, command, built, token, baseUrl, query);
		} catch (error) {
			if (error instanceof ApiFailure) {
				writeFailure(io, error, secrets, built.pii, asJson);
				return error.exitCode;
			}
			throw error;
		}
		const parsed = readPage(result.body);
		if (!parsed) {
			writeBody(io, result, secrets, asJson);
			io.stderr(`${nonJsonMessage(command.method, built.path)}\n`);
			return EXIT.server;
		}
		writePage(io, result, parsed.records, secrets, asJson);
		total += parsed.records.length;
		if (parsed.hasMore && !parsed.nextCursor) {
			io.stderr("page reported more results but no nextCursor\n");
			return EXIT.server;
		}
		if (!parsed.hasMore) {
			if (!asJson) io.stdout(redact(`${total} records, more: no\n`, secrets));
			return EXIT.ok;
		}
		if (page === cap - 1) break;
		await pause(io, result.rateLimitRemaining, result.rateLimitReset);
		cursor = parsed.nextCursor ?? undefined;
	}
	io.stderr("stopped at the page cap; pass --max-pages to raise it\n");
	return EXIT.usage;
}

async function runOutreachFile(
	io: CliIo,
	command: CommandSpec,
	flags: FlagMap,
	secrets: string[],
	token: string | undefined,
	baseUrl: string,
	asJson: boolean,
): Promise<number> {
	const file = flagString(flags, "file");
	if (file === undefined) throw new UsageError("pass --file");
	if (flagString(flags, "email") !== undefined || flagStringsPresent(flags, "profile-url")) {
		throw new UsageError("--file cannot be combined with --email or --profile-url");
	}
	const text = file === "-" ? (io.stdin ?? "") : await (io.readFile ?? readFileUtf8)(file);
	const rows = loadOutreachRows(text);
	let worst: ExitCode = EXIT.ok;
	let failed = 0;
	for (let index = 0; index < rows.length; index++) {
		const row = rows[index] ?? {};
		const built = buildOutreachQuery(row);
		try {
			const result = await callApi(
				io,
				command,
				{ method: "GET", path: "/contacts/outreach", query: built.query, pii: built.pii },
				token,
				baseUrl,
				built.query,
			);
			const body = isRecord(result.body) ? result.body : { result: result.body };
			const line = { input: echoInput(row), ...body };
			io.stdout(redact(`${JSON.stringify(line)}\n`, secrets));
			if (index < rows.length - 1) await pause(io, result.rateLimitRemaining, result.rateLimitReset);
		} catch (error) {
			if (!(error instanceof ApiFailure)) throw error;
			failed += 1;
			worst = Math.max(worst, error.exitCode) as ExitCode;
			const message = redactSigningSecrets(redact(error.message, [...secrets, ...built.pii])).trim();
			const line = { input: echoInput(row), error: { status: error.status ?? null, message } };
			io.stdout(redact(`${JSON.stringify(line)}\n`, secrets));
			if (index < rows.length - 1) await pause(io, error.rateLimitRemaining, error.rateLimitReset);
		}
	}
	if (!asJson) io.stderr(`rows: ${rows.length}, failed: ${failed}\n`);
	return worst;
}

async function callApi(
	io: CliIo,
	command: CommandSpec,
	built: BuiltRequest,
	token: string | undefined,
	baseUrl: string,
	query: Record<string, string | string[]>,
): Promise<ApiResult> {
	return apiRequest({
		method: built.method,
		path: built.path,
		query,
		body: built.body,
		token: command.auth ? token : undefined,
		baseUrl,
		expect: command.rawBody ? "text" : "json",
		userAgent: `outboundsync-cli/${getPackageVersion()}`,
		fetch: io.fetch,
		sleep: io.sleep ?? defaultSleep,
		now: () => clock(io).getTime(),
	});
}

function writeSuccess(io: CliIo, command: CommandSpec, result: ApiResult, secrets: string[], asJson: boolean): void {
	writeBody(io, result, secrets, asJson);
	if (!asJson && !result.raw) {
		const summary = humanSummary(command, result.body);
		if (summary) io.stdout(redact(summary, secrets));
	}
	if (command.secretOnce) io.stderr("Signing secret shown once; store it now.\n");
}

function writePage(io: CliIo, result: ApiResult, records: unknown[], secrets: string[], asJson: boolean): void {
	if (asJson) {
		for (const record of records) io.stdout(redact(`${JSON.stringify(record)}\n`, secrets));
		return;
	}
	writeBody(io, result, secrets, false);
}

function writeBody(io: CliIo, result: ApiResult, secrets: string[], asJson: boolean): void {
	if (result.raw) {
		const text = result.text.endsWith("\n") ? result.text : `${result.text}\n`;
		io.stdout(redact(text, secrets));
		return;
	}
	const text = asJson ? `${JSON.stringify(result.body)}\n` : `${JSON.stringify(result.body, null, 2)}\n`;
	io.stdout(redact(text, secrets));
}

function writeFailure(io: CliIo, error: ApiFailure, secrets: string[], pii: string[], asJson: boolean): void {
	const scrub = [...secrets, ...pii];
	let text: string;
	if (asJson && isRecord(error.body)) text = `${JSON.stringify(error.body)}\n`;
	else if (isRecord(error.body)) text = `${error.message}\n${JSON.stringify(error.body, null, 2)}\n`;
	else text = `${error.message}\n`;
	io.stderr(redactSigningSecrets(redact(text, scrub)));
}

function brokenCursor(command: CommandSpec, body: unknown): boolean {
	if (!command.paginated) return false;
	const page = readPage(body);
	return page !== undefined && page.hasMore && !page.nextCursor;
}

function replaceCursor(query: Record<string, string | string[]>, cursor: string | undefined): Record<string, string | string[]> {
	const next = { ...query };
	if (cursor) next.cursor = cursor;
	else delete next.cursor;
	return next;
}

async function pause(io: CliIo, remaining: number | null, resetSeconds: number | null): Promise<void> {
	const delay = paceDelayMs(remaining, resetSeconds);
	if (delay > 0) await (io.sleep ?? defaultSleep)(delay);
}

function clock(io: CliIo): Date {
	return (io.now ?? (() => new Date()))();
}

function requireToken(flags: FlagMap, env: NodeJS.ProcessEnv): string {
	const flag = flagString(flags, "token")?.trim();
	const fromEnv = env[TOKEN_ENV];
	const token = flag || (typeof fromEnv === "string" ? fromEnv.trim() : "");
	if (!token) throw new UsageError(`missing API key: set ${TOKEN_ENV} or pass --token`);
	// Never echo the value. Whitespace or control characters would also break the header.
	if (!/^[\x21-\x7e]+$/.test(token)) throw new UsageError("the API key contains whitespace or non-printable characters");
	return token;
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * The key is only ever sent to this origin. Require https so it never crosses the network in
 * clear text; plain http is allowed only for a loopback dev server.
 */
export function resolveBaseUrl(flags: FlagMap, env: NodeJS.ProcessEnv): string {
	const flag = flagString(flags, "base-url")?.trim();
	const fromEnv = env[BASE_URL_ENV];
	const raw = flag || (typeof fromEnv === "string" && fromEnv.trim() ? fromEnv.trim() : DEFAULT_BASE_URL);
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		throw new UsageError("--base-url must be an absolute https URL");
	}
	const loopback = LOOPBACK_HOSTS.has(url.hostname);
	if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
		throw new UsageError("--base-url must use https (http is allowed only for localhost)");
	}
	if (url.username || url.password || url.search || url.hash) {
		throw new UsageError("--base-url must not include credentials, a query string, or a fragment");
	}
	return `${url.origin}${url.pathname}`.replace(/\/+$/, "");
}

function flagStringsPresent(flags: FlagMap, name: string): boolean {
	const value = flags[name];
	return Array.isArray(value) ? value.length > 0 : typeof value === "string";
}

function echoInput(row: OutreachInput): OutreachInput {
	const input: OutreachInput = {};
	if (row.email) input.email = row.email;
	if (row.profileUrl && row.profileUrl.length > 0) input.profileUrl = [...row.profileUrl];
	return input;
}

function collectSecrets(io: CliIo, flags?: FlagMap): string[] {
	const secrets: string[] = [];
	const push = (value: string | undefined) => {
		const trimmed = value?.trim();
		if (trimmed) secrets.push(trimmed);
	};
	push(typeof io.env[TOKEN_ENV] === "string" ? io.env[TOKEN_ENV] : undefined);
	if (typeof flags?.token === "string") push(flags.token);
	for (let index = 0; index < io.argv.length; index++) {
		const arg = io.argv[index] ?? "";
		if (arg === "--token") push(io.argv[index + 1]);
		else if (arg.startsWith("--token=")) push(arg.slice("--token=".length));
	}
	return secrets;
}

export function redact(text: string, secrets: readonly string[]): string {
	const unique = [...new Set(secrets.filter((item) => item.length > 0))].sort((left, right) => right.length - left.length);
	return unique.reduce((out, secret) => out.split(secret).join("[redacted]"), text);
}

export function redactSigningSecrets(text: string): string {
	return text.replace(/oswhsec_[^\s"'\\]+/g, "[redacted]");
}

function launchedAsCli(): boolean {
	const self = fileURLToPath(import.meta.url);
	const argv1 = process.argv[1];
	if (!argv1) return false;
	try {
		return realpathSync(argv1) === realpathSync(self);
	} catch {
		return argv1.endsWith("outboundsync.ts") || argv1.endsWith("outboundsync.js") || /(^|\/)outboundsync$/.test(argv1);
	}
}

async function readStdin(): Promise<string> {
	if (process.stdin.isTTY) return "";
	const chunks: Buffer[] = [];
	let size = 0;
	for await (const chunk of process.stdin) {
		const buffer = typeof chunk === "string" ? Buffer.from(chunk) : (chunk as Buffer);
		size += buffer.length;
		// Stop reading once over the cap; loadOutreachRows rejects the oversized text.
		if (size > MAX_INPUT_BYTES) {
			chunks.push(buffer);
			process.stdin.destroy();
			break;
		}
		chunks.push(buffer);
	}
	return Buffer.concat(chunks).toString("utf8");
}

function wantsStdin(argv: readonly string[]): boolean {
	for (let index = 0; index < argv.length; index++) {
		const arg = argv[index] ?? "";
		if (arg === "--file=-") return true;
		if (arg === "--file" && argv[index + 1] === "-") return true;
	}
	return false;
}

async function readFileUtf8(filePath: string): Promise<string> {
	return readBoundedFile(filePath);
}

if (launchedAsCli()) {
	const stdin = wantsStdin(process.argv) ? await readStdin() : "";
	const code = await runCli({
		argv: process.argv.slice(2),
		env: process.env,
		stdout: (text) => {
			process.stdout.write(text);
		},
		stderr: (text) => {
			process.stderr.write(text);
		},
		fetch,
		stdin,
	});
	process.exitCode = code;
}

export { resolveDateRange, parseIsoTimestamp } from "./dates";
export { EXIT, DEFAULT_BASE_URL, TOKEN_ENV, BASE_URL_ENV } from "./const";
export { parseArgv, assertKnownFlags } from "./parse";
export { REGISTRY, flagsFor, resolveCommand } from "./registry";
export { buildRequest } from "./request";
export { rootHelp, commandHelp, commandUsage } from "./help";
export { commandsJson, commandsJsonText } from "./commands-json";
export { classifyHttpError } from "./errors";
