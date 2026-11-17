import { DEFAULT_MAX_PAGES } from "./const";
import { UsageError } from "./usage";

/** Sleep before the next call only when the server says the budget is spent. */
export function paceDelayMs(remaining: number | null, resetSeconds: number | null): number {
	if (remaining === null || remaining > 1) return 0;
	if (resetSeconds === null || resetSeconds <= 0) return 0;
	return resetSeconds * 1000;
}

export function maxPages(value: string | undefined): number {
	if (value === undefined) return DEFAULT_MAX_PAGES;
	if (!/^[1-9]\d*$/.test(value)) {
		throw new UsageError("--max-pages must be a positive integer");
	}
	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed)) {
		throw new UsageError("--max-pages must be a positive integer");
	}
	return parsed;
}
