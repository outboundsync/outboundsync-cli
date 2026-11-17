import { isRecord } from "./record";
import type { OutreachInput } from "./request";
import { UsageError } from "./usage";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function loadOutreachRows(text: string): OutreachInput[] {
	const stripped = text.replace(/^\uFEFF/, "");
	const first = firstNonEmpty(stripped);
	if (!first) throw new UsageError("file is empty");
	if (first.startsWith("[")) throw new UsageError("file must be JSONL or CSV, not a JSON array");
	if (first.startsWith("{")) return loadJsonl(stripped);
	return loadCsv(stripped);
}

function loadJsonl(text: string): OutreachInput[] {
	const rows: OutreachInput[] = [];
	const lines = text.split(/\r?\n/);
	for (let index = 0; index < lines.length; index++) {
		const line = lines[index] ?? "";
		if (line.trim() === "") continue;
		let value: unknown;
		try {
			value = JSON.parse(line) as unknown;
		} catch {
			throw new UsageError(`line ${index + 1}: invalid JSON`);
		}
		rows.push(rowFromRecord(value, index + 1));
	}
	if (rows.length === 0) throw new UsageError("file is empty");
	return rows;
}

function loadCsv(text: string): OutreachInput[] {
	const table = parseCsv(text);
	const header = table[0];
	if (!header) throw new UsageError("file is empty");
	const emailIndex = header.findIndex((cell) => cell.trim() === "email");
	const profileIndex = header.findIndex((cell) => cell.trim() === "profile_url");
	if (emailIndex < 0 && profileIndex < 0) {
		throw new UsageError("CSV needs an email or profile_url header");
	}
	const rows: OutreachInput[] = [];
	for (let index = 1; index < table.length; index++) {
		const cells = table[index] ?? [];
		if (cells.every((cell) => cell.trim() === "")) continue;
		const email = emailIndex >= 0 ? cells[emailIndex]?.trim() : undefined;
		const profileCell = profileIndex >= 0 ? cells[profileIndex]?.trim() : undefined;
		const profileUrl = profileCell ? profilesFromCell(profileCell, index + 1) : [];
		rows.push(rowFromParts(email || undefined, profileUrl, index + 1));
	}
	if (rows.length === 0) throw new UsageError("file is empty");
	return rows;
}

function rowFromRecord(value: unknown, line: number): OutreachInput {
	if (!isRecord(value)) throw new UsageError(`line ${line}: expected an object`);
	const email = typeof value.email === "string" ? value.email.trim() : undefined;
	const raw = value.profileUrl ?? value.profile_url;
	return rowFromParts(email || undefined, profilesFromValue(raw, line), line);
}

function rowFromParts(email: string | undefined, profileUrl: string[], line: number): OutreachInput {
	if (!email && profileUrl.length === 0) {
		throw new UsageError(`line ${line}: needs email or profile_url`);
	}
	if (profileUrl.length > 5) throw new UsageError(`line ${line}: at most 5 profile URLs`);
	if (email && !EMAIL_RE.test(email)) throw new UsageError(`line ${line}: invalid email`);
	const row: OutreachInput = {};
	if (email) row.email = email;
	if (profileUrl.length > 0) row.profileUrl = profileUrl;
	return row;
}

function profilesFromValue(raw: unknown, line: number): string[] {
	if (raw === undefined || raw === null || raw === "") return [];
	if (typeof raw === "string") return raw.trim() ? [raw.trim()] : [];
	if (Array.isArray(raw) && raw.every((item) => typeof item === "string")) {
		return raw.map((item) => item.trim()).filter((item) => item.length > 0);
	}
	throw new UsageError(`line ${line}: profile URL must be a string or a list of strings`);
}

function profilesFromCell(cell: string, line: number): string[] {
	if (cell.startsWith("[")) {
		try {
			return profilesFromValue(JSON.parse(cell) as unknown, line);
		} catch (error) {
			if (error instanceof UsageError) throw error;
			throw new UsageError(`line ${line}: invalid profile_url`);
		}
	}
	return [cell];
}

function firstNonEmpty(text: string): string {
	for (const line of text.split(/\r?\n/)) {
		if (line.trim()) return line.trim();
	}
	return "";
}

export function parseCsv(text: string): string[][] {
	const rows: string[][] = [];
	let row: string[] = [];
	let cell = "";
	let quoted = false;
	const src = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
	for (let index = 0; index < src.length; index++) {
		const char = src[index] ?? "";
		if (quoted) {
			if (char === '"') {
				if (src[index + 1] === '"') {
					cell += '"';
					index++;
				} else {
					quoted = false;
				}
			} else {
				cell += char;
			}
			continue;
		}
		if (char === '"') {
			quoted = true;
			continue;
		}
		if (char === ",") {
			row.push(cell);
			cell = "";
			continue;
		}
		if (char === "\n") {
			row.push(cell);
			cell = "";
			rows.push(row);
			row = [];
			continue;
		}
		cell += char;
	}
	if (quoted) throw new UsageError("file has an unterminated quote");
	if (cell.length > 0 || row.length > 0) {
		row.push(cell);
		rows.push(row);
	}
	return rows;
}
