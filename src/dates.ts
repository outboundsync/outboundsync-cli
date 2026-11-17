import { UsageError } from "./usage";

/** Flat 31 × 24h cap, inclusive. Matches the API and the MCP client. */
export const MAX_RANGE_DAYS = 31;
const DAY_MS = 24 * 60 * 60 * 1000;
export const MAX_RANGE_MS = MAX_RANGE_DAYS * DAY_MS;

const SINCE_MS = {
	"24h": 24 * 60 * 60 * 1000,
	"7d": 7 * DAY_MS,
	"30d": 30 * DAY_MS,
} as const;

export type SinceToken = keyof typeof SINCE_MS;

const ISO_RE =
	/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/;

export function parseIsoTimestamp(value: string): number {
	const match = ISO_RE.exec(value);
	if (!match) {
		throw new UsageError(
			`expected an ISO-8601 timestamp with a timezone offset, got ${value}`,
		);
	}
	const ms = Date.parse(value);
	if (!Number.isFinite(ms)) {
		throw new UsageError(`expected an ISO-8601 timestamp with a timezone offset, got ${value}`);
	}
	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	const hour = Number(match[4]);
	const minute = Number(match[5]);
	const second = Number(match[6]);
	const fraction = match[7] ? Number(match[7]) : 0;
	const offset = match[8] ?? "Z";
	let offsetMinutes = 0;
	if (offset !== "Z") {
		const sign = offset.startsWith("-") ? -1 : 1;
		const hours = Number(offset.slice(1, 3));
		const minutes = Number(offset.slice(4, 6));
		offsetMinutes = sign * (hours * 60 + minutes);
	}
	const wall = new Date(ms + offsetMinutes * 60 * 1000);
	const fractionMs = Math.round(fraction * 1000);
	if (
		wall.getUTCFullYear() !== year ||
		wall.getUTCMonth() + 1 !== month ||
		wall.getUTCDate() !== day ||
		wall.getUTCHours() !== hour ||
		wall.getUTCMinutes() !== minute ||
		wall.getUTCSeconds() !== second ||
		wall.getUTCMilliseconds() !== fractionMs
	) {
		throw new UsageError(`expected an ISO-8601 timestamp with a timezone offset, got ${value}`);
	}
	return ms;
}

export function resolveDateRange(
	input: { from?: string; to?: string; since?: string },
	now: Date,
): { from: string; to: string } {
	const { from, to, since } = input;
	if (since !== undefined && (from !== undefined || to !== undefined)) {
		throw new UsageError("--since cannot be combined with --from or --to");
	}
	if (since !== undefined) {
		if (!isSinceToken(since)) {
			throw new UsageError("--since must be 24h, 7d, or 30d");
		}
		const end = now.getTime();
		const start = end - SINCE_MS[since];
		return { from: new Date(start).toISOString(), to: new Date(end).toISOString() };
	}
	if (from === undefined || to === undefined) {
		throw new UsageError("pass --from and --to, or --since 24h|7d|30d");
	}
	const startMs = parseIsoTimestamp(from);
	const endMs = parseIsoTimestamp(to);
	assertSpan(startMs, endMs);
	return { from, to };
}

export function assertSpan(startMs: number, endMs: number): void {
	const spanMs = endMs - startMs;
	if (spanMs < 0) {
		throw new UsageError("`to` must be on or after `from`.");
	}
	if (spanMs > MAX_RANGE_MS) {
		throw new UsageError(
			`Range spans ${(spanMs / DAY_MS).toFixed(1)} days; the maximum is ${MAX_RANGE_DAYS}. Split it into smaller windows.`,
		);
	}
}

function isSinceToken(value: string): value is SinceToken {
	return Object.hasOwn(SINCE_MS, value);
}
