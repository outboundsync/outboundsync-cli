import { BASE_URL_ENV, DEFAULT_BASE_URL, TOKEN_ENV } from "./const";
import { flagsFor, REGISTRY, type CommandSpec, type FlagSpec } from "./registry";

export function rootHelp(): string {
	const labels = REGISTRY.map((command) => command.words.join(" "));
	const width = Math.max(...labels.map((label) => label.length));
	const lines = [
		"outboundsync — call the OutboundSync API",
		"",
		"Usage:",
		"  outboundsync <command> [flags]",
		"",
		"Commands:",
	];
	REGISTRY.forEach((command, index) => {
		lines.push(`  ${labels[index]?.padEnd(width)}  ${command.help}`);
	});
	lines.push(
		"",
		"Auth:",
		`  ${TOKEN_ENV} (preferred) or --token. The key is not stored or printed.`,
		"  A --token value is visible in shell history and the process list.",
		`  ${BASE_URL_ENV} or --base-url. Default ${DEFAULT_BASE_URL}.`,
		"",
		"Global flags:",
		"  --token <key>       API key. Overrides the environment variable.",
		"  --base-url <url>    https API base, including /api/v1.",
		"  --json              Compact JSON on stdout. No human summary.",
		"  -h, --help          Show help.",
		"  -V, --version       Show the version.",
		"",
		"Write commands do nothing without --yes.",
		"",
		"Exit codes: 0 ok · 1 usage · 2 unauthorized (401) · 3 forbidden (403)",
		"            4 rate limited (429) · 5 server, timeout, or network · 6 other HTTP error",
		"",
	);
	return lines.join("\n");
}

export function commandHelp(command: CommandSpec): string {
	const lines = [
		commandUsage(command),
		"",
		command.help,
		"",
		`Scope: ${command.scope}`,
	];
	if (!command.auth) lines.push("Auth: not required");
	if (command.dateRange === "required") {
		lines.push("Date range: at most 31 days. Pass --from and --to, or --since 24h|7d|30d.");
	}
	if (command.paginated === "activity") lines.push("Pages: --limit max 500. --all follows the cursor.");
	if (command.paginated === "webhook") lines.push("Pages: --limit max 100. --all follows the cursor.");
	if (command.confirm) lines.push(command.confirm);
	const flags = flagsFor(command);
	if (flags.length > 0) {
		lines.push("", "Flags:");
		const width = Math.max(...flags.map((flag) => flagLabel(flag).length));
		for (const flag of flags) {
			lines.push(`  ${flagLabel(flag).padEnd(width)}  ${flag.help}`);
		}
	}
	lines.push("");
	return lines.join("\n");
}

export function commandUsage(command: CommandSpec): string {
	const parts = ["outboundsync", ...command.words];
	for (const arg of command.args) parts.push(`<${arg.name}>`);
	if (command.dateRange === "required") parts.push("(--from <iso> --to <iso> | --since 24h|7d|30d)");
	return `usage: ${parts.join(" ")}`;
}

export function groupHelp(words: readonly string[]): string {
	const matches = REGISTRY.filter(
		(command) =>
			command.words.length > words.length && words.every((word, index) => command.words[index] === word),
	);
	const lines = [`usage: outboundsync ${words.join(" ")} <command>`, "", "Commands:"];
	const labels = matches.map((command) => command.words.slice(words.length).join(" "));
	const width = Math.max(1, ...labels.map((label) => label.length));
	matches.forEach((command, index) => {
		lines.push(`  ${labels[index]?.padEnd(width)}  ${command.help}`);
	});
	lines.push("");
	return lines.join("\n");
}

function flagLabel(flag: FlagSpec): string {
	if (flag.boolean) return `--${flag.name}`;
	if (flag.values && flag.values.length > 0 && flag.values.length <= 6) {
		const choice = flag.values.join("|");
		return flag.repeatable ? `--${flag.name} ${choice}` : `--${flag.name} ${choice}`;
	}
	if (flag.repeatable) return `--${flag.name} <value>`;
	if (flag.integer) return `--${flag.name} <n>`;
	return `--${flag.name} <value>`;
}
