import { GLOBAL_FLAGS } from "./const";
import { flagsFor, REGISTRY, type CommandSpec } from "./registry";
import { UsageError } from "./usage";

export type FlagValue = string | string[] | true;
export type FlagMap = Record<string, FlagValue>;

export interface ParsedArgv {
	positionals: string[];
	flags: FlagMap;
}

const KNOWN = knownFlagNames();
const BOOLEAN = booleanFlagNames();
const REPEATABLE = repeatableFlagNames();

export function parseArgv(argv: readonly string[]): ParsedArgv {
	const positionals: string[] = [];
	const flags: FlagMap = {};
	let ended = false;
	for (let index = 0; index < argv.length; index++) {
		const arg = argv[index] ?? "";
		if (ended) {
			positionals.push(arg);
			continue;
		}
		if (arg === "--") {
			ended = true;
			continue;
		}
		if (!arg.startsWith("-") || arg === "-") {
			positionals.push(arg);
			continue;
		}
		const body = arg.startsWith("--") ? arg.slice(2) : arg.slice(1);
		if (body.length === 0) {
			throw new UsageError(`unknown flag ${arg}`);
		}
		const eq = body.indexOf("=");
		const name = eq === -1 ? body : body.slice(0, eq);
		const inline = eq === -1 ? undefined : body.slice(eq + 1);
		if (!KNOWN.has(name)) {
			const label = arg.startsWith("--") ? `--${name}` : arg;
			throw new UsageError(`unknown flag ${label}`);
		}
		if (BOOLEAN.has(name)) {
			if (inline !== undefined) {
				throw new UsageError(`--${name} does not take a value`);
			}
			flags[name] = true;
			continue;
		}
		const value = inline !== undefined ? inline : argv[index + 1];
		if (inline === undefined) index++;
		if (value === undefined || value.startsWith("--") || value === "") {
			throw new UsageError(`--${name} requires a value`);
		}
		if (REPEATABLE.has(name)) {
			const current = flags[name];
			if (current === undefined) flags[name] = [value];
			else if (Array.isArray(current)) current.push(value);
			else if (typeof current === "string") flags[name] = [current, value];
			else throw new UsageError(`--${name} does not take a value`);
			continue;
		}
		if (flags[name] !== undefined) {
			throw new UsageError(`--${name} was passed more than once`);
		}
		flags[name] = value;
	}
	return { positionals, flags };
}

export function assertKnownFlags(command: CommandSpec, flags: FlagMap): void {
	const allowed = new Set<string>(GLOBAL_FLAGS);
	for (const flag of flagsFor(command)) allowed.add(flag.name);
	for (const name of Object.keys(flags)) {
		if (!allowed.has(name)) {
			throw new UsageError(`--${name} is not valid for ${command.words.join(" ")}`);
		}
	}
}

export function flagString(flags: FlagMap, name: string): string | undefined {
	const value = flags[name];
	if (value === undefined || value === true) return undefined;
	if (Array.isArray(value)) {
		throw new UsageError(`--${name} was passed more than once`);
	}
	return value;
}

export function flagStrings(flags: FlagMap, name: string): string[] {
	const value = flags[name];
	if (value === undefined) return [];
	if (value === true) throw new UsageError(`--${name} does not take a value`);
	return Array.isArray(value) ? value : [value];
}

export function flagBool(flags: FlagMap, name: string): boolean {
	return flags[name] === true;
}

function knownFlagNames(): Set<string> {
	const names = new Set<string>(GLOBAL_FLAGS);
	for (const command of REGISTRY) {
		for (const flag of flagsFor(command)) names.add(flag.name);
	}
	return names;
}

function booleanFlagNames(): Set<string> {
	const names = new Set<string>(["help", "h", "json", "version", "V"]);
	for (const command of REGISTRY) {
		for (const flag of flagsFor(command)) {
			if (flag.boolean) names.add(flag.name);
		}
	}
	return names;
}

function repeatableFlagNames(): Set<string> {
	const names = new Set<string>();
	for (const command of REGISTRY) {
		for (const flag of flagsFor(command)) {
			if (flag.repeatable) names.add(flag.name);
		}
	}
	return names;
}
