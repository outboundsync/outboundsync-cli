import { DEFAULT_BASE_URL, EXIT, REQUEST_TIMEOUT_MS, RETRY_BUDGET_MS } from "./const";
import {
	ApiFailure,
	classifyHttpError,
	networkMessage,
	nonJsonMessage,
	redirectMessage,
	timeoutMessage,
} from "./errors";
import { isRecord } from "./record";

export interface ApiRequest {
	method: string;
	path: string;
	query?: Record<string, string | string[]>;
	body?: unknown;
	token?: string;
	baseUrl?: string;
	expect: "json" | "text";
	userAgent: string;
	fetch: typeof fetch;
	sleep: (ms: number) => Promise<void>;
	now: () => number;
}

export interface ApiResult {
	status: number;
	body: unknown;
	text: string;
	raw: boolean;
	rateLimitRemaining: number | null;
	rateLimitReset: number | null;
}

export async function apiRequest(input: ApiRequest): Promise<ApiResult> {
	const base = (input.baseUrl?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, "");
	const path = input.path.startsWith("/") ? input.path : `/${input.path}`;
	const url = new URL(`${base}${path}`);
	for (const [key, value] of Object.entries(input.query ?? {})) {
		if (Array.isArray(value)) {
			for (const item of value) url.searchParams.append(key, item);
		} else {
			url.searchParams.set(key, value);
		}
	}
	const safe = `${input.method} ${path}`;
	const headers: Record<string, string> = {
		Accept: input.expect === "text" ? "application/yaml, application/json;q=0.9, */*;q=0.8" : "application/json",
		"User-Agent": input.userAgent,
	};
	if (input.token) headers.Authorization = `Bearer ${input.token}`;
	let payload: string | undefined;
	if (input.body !== undefined) {
		payload = JSON.stringify(input.body);
		headers["Content-Type"] = "application/json";
	}
	const started = input.now();
	let serverRetried = false;
	let rateRetried = false;

	for (;;) {
		let response: Response;
		try {
			response = await input.fetch(url, {
				method: input.method,
				headers,
				body: payload,
				signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
				// Never follow a redirect: the Authorization header must not reach another URL.
				redirect: "manual",
			});
		} catch (error) {
			const aborted =
				(error instanceof Error && error.name === "TimeoutError") ||
				(error instanceof Error && error.name === "AbortError");
			if (aborted) {
				throw new ApiFailure(timeoutMessage(input.method, path), 5, undefined, undefined);
			}
			const cause = error instanceof Error ? error.message : "network error";
			throw new ApiFailure(
				networkMessage(safe, scrubUrl(cause, url.toString(), safe)),
				5,
				undefined,
				undefined,
			);
		}

		const rateLimitRemaining = headerNumber(response.headers, "x-ratelimit-remaining");
		const rateLimitReset = headerNumber(response.headers, "x-ratelimit-reset");
		const text = await response.text();
		const status = response.status;

		if (status >= 300 && status < 400) {
			throw new ApiFailure(redirectMessage(input.method, path, status), EXIT.http, status, undefined);
		}

		if (status >= 200 && status < 300) {
			if (status === 204 || status === 205) {
				return { status, body: { ok: true }, text, raw: false, rateLimitRemaining, rateLimitReset };
			}
			if (input.expect === "text") {
				return { status, body: text, text, raw: true, rateLimitRemaining, rateLimitReset };
			}
			const body = parseJsonObject(text, input.method, path);
			return { status, body, text, raw: false, rateLimitRemaining, rateLimitReset };
		}

		const body = parseJsonValue(text);
		const retryAfter = parseRetryAfter(response.headers.get("retry-after"));
		const classified = classifyHttpError(status, body, input.method, path, retryAfter);
		const failure = new ApiFailure(
			classified.message,
			classified.exitCode,
			status,
			body,
			rateLimitRemaining,
			rateLimitReset,
		);

		if (status === 429 && !rateRetried) {
			rateRetried = true;
			if (withinBudget(started, input.now(), retryAfter * 1000)) {
				await input.sleep(retryAfter * 1000);
				continue;
			}
		}

		if (status >= 500 && status !== 504 && input.method === "GET" && !serverRetried) {
			serverRetried = true;
			if (withinBudget(started, input.now(), 1000)) {
				await input.sleep(1000);
				continue;
			}
		}

		throw failure;
	}
}

function withinBudget(started: number, now: number, waitMs: number): boolean {
	return now - started + waitMs <= RETRY_BUDGET_MS;
}

function parseJsonObject(text: string, method: string, path: string): Record<string, unknown> {
	const value = parseJsonValue(text);
	if (!isRecord(value)) {
		throw new ApiFailure(nonJsonMessage(method, path), 5, 200, undefined);
	}
	return value;
}

function parseJsonValue(text: string): unknown {
	try {
		return JSON.parse(text) as unknown;
	} catch {
		return text;
	}
}

/** Retry-After is a delay in seconds. Missing or unparsable values default to 60. */
export function parseRetryAfter(header: string | null): number {
	if (header === null) return 60;
	const seconds = Number(header.trim());
	if (!Number.isFinite(seconds) || seconds < 0) return 60;
	return seconds;
}

function headerNumber(headers: Headers, name: string): number | null {
	const raw = headers.get(name);
	if (raw === null || raw.trim() === "") return null;
	const value = Number(raw);
	return Number.isFinite(value) ? value : null;
}

function scrubUrl(message: string, fetched: string, safe: string): string {
	return message.split(fetched).join(safe);
}

export function defaultSleep(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}
