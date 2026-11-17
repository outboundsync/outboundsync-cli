import { DEFAULT_MAX_PAGES } from "./const";
import { UsageError } from "./usage";

const MAX_PACE_SECONDS = 60;

/** Sleep before the next call only when the server says the budget is spent. */
export function paceDelayMs(remaining: number | null, resetSeconds: number | null): number {
	if (remaining === null || remaining > 1) return 0;
	if (resetSeconds === null || resetSeconds <= 0) return 0;
	// The API's windows are 60 seconds. Cap the wait so a bad header cannot stall the run.
	return Math.min(resetSeconds, MAX_PACE_SECONDS) * 1000;
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
