import { API_KEYS_URL, EXIT, type ExitCode } from "./const";
import { isRecord } from "./record";

export class ApiFailure extends Error {
	readonly name = "ApiFailure";

	constructor(
		message: string,
		readonly exitCode: ExitCode,
		readonly status: number | undefined,
		readonly body: unknown,
		readonly rateLimitRemaining: number | null = null,
		readonly rateLimitReset: number | null = null,
	) {
		super(message);
	}
}

export function nestMessage(body: unknown): string | undefined {
	if (!isRecord(body)) return undefined;
	const message = body.message;
	if (typeof message === "string" && message.length > 0) return message;
	if (Array.isArray(message) && message.every((item) => typeof item === "string")) {
		return message.join("; ");
	}
	return undefined;
}

/** Each 403 cause has a different fix. Match the upstream message. */
export function forbiddenRemediation(detail: string | undefined): string {
	const text = detail ?? "";
	if (/account-scoped/i.test(text)) {
		return `Create an account-scoped key under Platform access → API keys (${API_KEYS_URL}); connection-scoped keys cannot manage platform webhooks.`;
	}
	if (/platform webhooks are not enabled/i.test(text)) {
		return "Platform webhooks (Sync Monitoring) are not enabled for this account. Ask an OutboundSync admin or support to enable them; there is no API call for this.";
	}
	if (/block ?lists are not enabled/i.test(text)) {
		return "Block lists are not enabled for this connection's plan. Enable them in the OutboundSync dashboard before resyncing.";
	}
	if (/write/i.test(text)) {
		return "This command needs an API key with the write scope. Keys created under Platform access → API keys are read-only; ask OutboundSync support to issue a write-scoped key.";
	}
	return "If API access is not enabled for any connection on this account, ask OutboundSync support to enable it; there is no API call for this. Write commands also require a key with the write scope; webhook management requires an account-scoped key.";
}

function withPeriod(text: string): string {
	return /[.!?]$/.test(text) ? text : `${text}.`;
}

export function classifyHttpError(
	status: number,
	body: unknown,
	method: string,
	path: string,
	retryAfterSeconds?: number,
): { exitCode: ExitCode; message: string } {
	const detail = nestMessage(body);
	if (status === 401) {
		return {
			exitCode: EXIT.unauthorized,
			message: `${withPeriod(detail ?? "Invalid API key.")} Verify the key (osapi_...) under Platform access → API keys (${API_KEYS_URL}) and that it has not been revoked.`,
		};
	}
	if (status === 403) {
		return {
			exitCode: EXIT.forbidden,
			message: `${withPeriod(detail ?? "API access is not enabled for this account.")} ${forbiddenRemediation(detail)}`,
		};
	}
	if (status === 429) {
		const wait = retryAfterSeconds === undefined ? "" : ` Wait ${retryAfterSeconds}s and retry.`;
		return {
			exitCode: EXIT.rateLimited,
			message: `${withPeriod(detail ?? "OutboundSync API rate limit exceeded.")}${wait} Limits are shared per account.`,
		};
	}
	if (status === 409 && isRecord(body) && typeof body.retryAfterSeconds === "number") {
		const at = typeof body.retryAvailableAt === "string" ? ` at ${body.retryAvailableAt}` : "";
		return {
			exitCode: EXIT.http,
			message: `${detail ?? "A bulk retry was already requested for this source in the last 24 hours."} Next bulk retry${at} (in ${body.retryAfterSeconds}s). Use \`syncs retry <id>\` for individual syncs.`,
		};
	}
	if (status === 400 || status === 422) {
		return {
			exitCode: EXIT.http,
			message: detail ?? `OutboundSync API rejected the ${method} ${path} request.`,
		};
	}
	if (status === 404) {
		return {
			exitCode: EXIT.http,
			message: detail ?? `Not found: ${method} ${path}.`,
		};
	}
	if (status === 504) {
		return {
			exitCode: EXIT.server,
			message: `${withPeriod(detail ?? `OutboundSync API exceeded its query time limit for ${method} ${path}.`)} narrow --from/--to or pass --connection-id.`,
		};
	}
	if (status >= 500) {
		return {
			exitCode: EXIT.server,
			message: detail ?? `OutboundSync API returned HTTP ${status} for ${method} ${path}.`,
		};
	}
	return {
		exitCode: EXIT.http,
		message: detail ?? `OutboundSync API returned HTTP ${status} for ${method} ${path}.`,
	};
}

export function timeoutMessage(method: string, path: string): string {
	return `The OutboundSync API did not answer ${method} ${path} in time.`;
}

export function networkMessage(safeUrl: string, cause: string): string {
	return `Could not reach the OutboundSync API at ${safeUrl}: ${cause}`;
}

export function nonJsonMessage(method: string, path: string): string {
	return `OutboundSync API returned a non-JSON response for ${method} ${path}. The hosting layer answered instead of the API. Treat the result as unknown and retry shortly.`;
}
