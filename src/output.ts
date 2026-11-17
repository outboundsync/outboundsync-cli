import type { CommandSpec } from "./registry";
import { isRecord } from "./record";

export function humanSummary(command: CommandSpec, body: unknown): string {
	switch (command.summary) {
		case undefined:
			return "";
		case "me":
			return summarizeMe(body);
		case "status":
			return summarizeStatus(body);
		case "setup":
			return summarizeSetup(body);
		case "list":
			return summarizeList(body, command);
		default: {
			const unreachable: never = command.summary;
			return unreachable;
		}
	}
}

function summarizeMe(body: unknown): string {
	if (!isRecord(body) || !isRecord(body.account) || !isRecord(body.apiKey)) return "";
	const account = body.account;
	const key = body.apiKey;
	const who = typeof account.email === "string" && account.email ? account.email : String(account.id ?? "");
	const scopes = Array.isArray(key.scopes) ? key.scopes.filter((item) => typeof item === "string").join(",") : "";
	const connectionScope = typeof key.connectionScope === "string" ? key.connectionScope : "";
	if (!who) return "";
	return `account ${who} · scopes ${scopes || "none"} · connection scope ${connectionScope || "unknown"}\n`;
}

function summarizeStatus(body: unknown): string {
	if (!isRecord(body) || typeof body.ready !== "boolean") return "";
	const blockers = Array.isArray(body.blockers)
		? body.blockers
				.map((item) => (isRecord(item) && typeof item.code === "string" ? item.code : ""))
				.filter((code) => code.length > 0)
		: [];
	return `ready: ${body.ready ? "yes" : "no"}\nblockers: ${blockers.length > 0 ? blockers.join(", ") : "none"}\n`;
}

function summarizeSetup(body: unknown): string {
	if (!isRecord(body) || !Array.isArray(body.steps)) return "";
	const steps = body.steps.filter((item) => isRecord(item));
	const ready = steps.filter((item) => item.status === "ready").length;
	return `steps ready: ${ready}/${steps.length}\n`;
}

function summarizeList(body: unknown, command: CommandSpec): string {
	if (command.paginated) {
		const page = readPage(body);
		if (!page) return "";
		return pageLine(page.records.length, page.hasMore, page.nextCursor);
	}
	const key = command.summaryKey;
	if (!key || !isRecord(body) || !Array.isArray(body[key])) return "";
	return `${body[key].length} records\n`;
}

export function pageLine(count: number, hasMore: boolean, cursor: string | null): string {
	if (hasMore && cursor) return `${count} records, more: yes → --cursor ${cursor}\n`;
	return `${count} records, more: no\n`;
}

export interface Page {
	records: unknown[];
	hasMore: boolean;
	nextCursor: string | null;
}

export function readPage(body: unknown): Page | undefined {
	if (!isRecord(body) || !Array.isArray(body.data)) return undefined;
	const hasMore = body.hasMore === true;
	const nextCursor = typeof body.nextCursor === "string" && body.nextCursor.length > 0 ? body.nextCursor : null;
	return { records: body.data, hasMore, nextCursor };
}
