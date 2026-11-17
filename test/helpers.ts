import { runCli, type CliIo } from "../dist/outboundsync.js";

export interface MockCall {
	url: string;
	method: string;
	headers: Record<string, string>;
	body?: unknown;
}

export interface MockResponse {
	status: number;
	body?: unknown;
	text?: string;
	headers?: Record<string, string>;
}

export interface RunOptions {
	argv: string[];
	env?: NodeJS.ProcessEnv;
	responses?: MockResponse[];
	fetchImpl?: typeof fetch;
	stdin?: string;
	files?: Record<string, string>;
	now?: Date;
}

export interface RunResult {
	code: number;
	stdout: string;
	stderr: string;
	calls: MockCall[];
	sleeps: number[];
}

const FIXED_NOW = new Date("2026-08-13T12:00:00.000Z");

export async function run(options: RunOptions): Promise<RunResult> {
	const calls: MockCall[] = [];
	const sleeps: number[] = [];
	const queued = [...(options.responses ?? [{ status: 200, body: { ok: true } }])];
	const fetchImpl: typeof fetch =
		options.fetchImpl ??
		(async (url, init) => {
			const headers = headerRecord(init?.headers);
			let body: unknown;
			if (typeof init?.body === "string" && init.body.length > 0) {
				body = JSON.parse(init.body) as unknown;
			}
			calls.push({ url: String(url), method: init?.method ?? "GET", headers, body });
			const next = queued.shift();
			if (!next) {
				return new Response(JSON.stringify({ message: "no more responses" }), { status: 500 });
			}
			const payload = next.text !== undefined ? next.text : next.body === undefined ? null : JSON.stringify(next.body);
			return new Response(payload, { status: next.status, headers: next.headers });
		});
	let stdout = "";
	let stderr = "";
	const io: CliIo = {
		argv: options.argv,
		env: options.env ?? { OUTBOUNDSYNC_API_KEY: "osapi_test_secret_value" },
		stdout: (text) => {
			stdout += text;
		},
		stderr: (text) => {
			stderr += text;
		},
		fetch: fetchImpl,
		stdin: options.stdin ?? "",
		readFile: async (filePath) => {
			const text = options.files?.[filePath];
			if (text === undefined) throw new Error(`missing file ${filePath}`);
			return text;
		},
		now: () => options.now ?? FIXED_NOW,
		sleep: async (ms) => {
			sleeps.push(ms);
		},
	};
	const code = await runCli(io);
	return { code, stdout, stderr, calls, sleeps };
}

export function header(headers: Record<string, string>, name: string): string | undefined {
	const found = Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase());
	return found?.[1];
}

function headerRecord(headers: HeadersInit | undefined): Record<string, string> {
	if (!headers) return {};
	if (headers instanceof Headers) {
		const out: Record<string, string> = {};
		headers.forEach((value, key) => {
			out[key] = value;
		});
		return out;
	}
	if (Array.isArray(headers)) return Object.fromEntries(headers);
	return { ...headers };
}
