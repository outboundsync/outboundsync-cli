/**
 * Characters a terminal can act on: C0 controls other than tab and newline, DEL, C1 controls
 * (U+0080–U+009F, which include the 8-bit CSI), the Unicode line/paragraph separators, and the
 * bidi embedding/override/isolate controls used to disguise text.
 */
const UNSAFE = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g;

/**
 * Make API-controlled text safe to write to a terminal. Each unsafe character becomes a visible
 * `\uXXXX` escape. Inside JSON produced by `JSON.stringify` these characters only occur within
 * string literals, and `\uXXXX` is the same character to a JSON parser, so `--json` output still
 * parses to the same value.
 */
export function safeTerminalText(text: string): string {
	return text.replace(UNSAFE, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`);
}
