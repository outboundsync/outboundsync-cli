export const DEFAULT_BASE_URL = "https://app.outboundsync.com/api/v1";
export const TOKEN_ENV = "OUTBOUNDSYNC_API_KEY";
export const BASE_URL_ENV = "OUTBOUNDSYNC_API_BASE_URL";
export const API_KEYS_URL = "https://app.outboundsync.com/admin/dashboard/api-keys";

export const REQUEST_TIMEOUT_MS = 30_000;
export const RETRY_BUDGET_MS = 30_000;
export const DEFAULT_MAX_PAGES = 200;

/** Process exit codes. HTTP classes are distinct so scripts can branch. */
export const EXIT = {
	ok: 0,
	usage: 1,
	unauthorized: 2,
	forbidden: 3,
	rateLimited: 4,
	server: 5,
	http: 6,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

export const GLOBAL_FLAGS = new Set(["token", "base-url", "help", "h", "json", "version", "V"]);
