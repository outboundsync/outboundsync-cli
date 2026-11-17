import { DEFAULT_BASE_URL } from "./const";
import { commandUsage } from "./help";
import { flagsFor, REGISTRY } from "./registry";

/**
 * The command reference as data (`commands.json`, schema `cli.commands.v1`),
 * built from REGISTRY so the websites can render their CLI docs from it.
 * Same shape as the kingminos CLI's. No version or date: the file changes only
 * when a command does. `npm run commands:json` writes it; a test fails when
 * the committed file differs from this output.
 */
export interface CommandsJson {
	schema: "cli.commands.v1";
	cli: string;
	commands: CommandEntry[];
}

export interface CommandEntry {
	id: string;
	usage: string;
	summary: string;
	method: string;
	/** The OpenAPI path, including the /api/v1 prefix. */
	path: string;
	flags: FlagEntry[];
	/** Changes data in the account (every non-GET command; each needs --yes). */
	write: boolean;
	/** Needs an API key. */
	auth: boolean;
}

export interface FlagEntry {
	name: string;
	help: string;
	/** The command fails with a usage error without it. */
	required: boolean;
	values?: string[];
}

const API_PREFIX = new URL(DEFAULT_BASE_URL).pathname.replace(/\/+$/, "");

export function commandsJson(): CommandsJson {
	const commands = REGISTRY.map(
		(command): CommandEntry => ({
			id: command.id,
			usage: commandUsage(command).replace(/^usage: /, ""),
			summary: command.help,
			method: command.method,
			path: `${API_PREFIX}${command.path}`,
			flags: flagsFor(command).map((flag) => ({
				name: flag.name,
				help: flag.help,
				required: flag.required === true,
				...(flag.values ? { values: [...flag.values] } : {}),
			})),
			write: command.scope === "write",
			auth: command.auth,
		}),
	).sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
	return { schema: "cli.commands.v1", cli: "outboundsync", commands };
}

/** The exact bytes of commands.json. */
export function commandsJsonText(): string {
	return `${JSON.stringify(commandsJson(), null, 2)}\n`;
}
