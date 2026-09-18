/**
 * Source-level parsers behind the cross-language ABI contract check.
 *
 * Each one reads a hand-maintained declaration list out of source: the
 * TypeScript symbol tables, the Zig export block, the Go cgo directives and the
 * Rust no_mangle attributes. tools/check-abi.ts only compares what these
 * return, so a parser that silently matches nothing makes the whole gate report
 * success while checking nothing.
 *
 * That is not hypothetical. The TypeScript parser below keyed off a fixed
 * indentation width, matched zero keys under the width the file happened to
 * use, and the gate passed for as long as that held. The Zig parser required a
 * line beginning with `export fn` while every export is written `pub export
 * fn`, so it reported all fifteen Zig symbols as missing.
 *
 * They live in their own module so they can be tested against fixtures rather
 * than only through the real sources, where a parser that matches nothing and a
 * contract that genuinely holds look identical except in the counts.
 */

/** Extract the keys of a named object literal from the TS bridge. */
export function tsSymbols(source: string, constName: string): Set<string> {
	const start = source.indexOf(`const ${constName}`);
	if (start === -1) throw new Error(`TS: const ${constName} not found`);

	// Walk braces from the opening brace to its match.
	const open = source.indexOf("{", start);
	let depth = 0;
	let end = open;
	for (let i = open; i < source.length; i++) {
		if (source[i] === "{") depth++;
		else if (source[i] === "}") {
			depth--;
			if (depth === 0) {
				end = i;
				break;
			}
		}
	}

	const body = source.slice(open, end);
	const names = new Set<string>();

	// The symbol names are the keys at the literal's own depth. Slicing from
	// the opening brace leaves that brace in the body, so the keys sit at
	// depth 1 and everything nested is deeper. Keying off a fixed amount of
	// indentation instead binds this to a whitespace style: it matched
	// nothing under four spaces, and once the repo was reformatted to tabs it
	// matched `args` and `returns` two levels down and reported them as
	// missing symbols.
	const key = /([A-Za-z_$][A-Za-z0-9_$]*)\s*:/y;
	let depthInBody = 0;
	for (let i = 0; i < body.length; i++) {
		const ch = body[i];

		if (ch === "{") {
			depthInBody++;
			continue;
		}
		if (ch === "}") {
			depthInBody--;
			continue;
		}
		// Skip comments and strings so a colon inside either is never read as
		// the end of a key.
		if (ch === "/" && body[i + 1] === "/") {
			while (i < body.length && body[i] !== "\n") i++;
			continue;
		}
		if (ch === '"' || ch === "'" || ch === "`") {
			for (i++; i < body.length && body[i] !== ch; i++) {
				if (body[i] === "\\") i++;
			}
			continue;
		}
		if (depthInBody !== 1) continue;

		key.lastIndex = i;
		const m = key.exec(body);
		if (m) {
			names.add(m[1]);
			i = key.lastIndex - 1;
		}
	}
	return names;
}

/** `//export Name` directives in a Go cgo shim. */
export function goExports(source: string): Set<string> {
	const names = new Set<string>();
	for (const m of source.matchAll(/^\/\/export\s+([A-Za-z_][A-Za-z0-9_]*)/gm)) {
		names.add(m[1]);
	}
	return names;
}

/** `#[no_mangle] pub extern "C" fn name` in Rust. */
export function rustExports(source: string): Set<string> {
	const names = new Set<string>();
	const re =
		/#\[no_mangle\]\s*pub\s+extern\s+"C"\s+fn\s+([A-Za-z_][A-Za-z0-9_]*)/g;
	for (const m of source.matchAll(re)) names.add(m[1]);
	return names;
}

/** `export fn name` in Zig, with or without `pub`. */
export function zigExports(source: string): Set<string> {
	const names = new Set<string>();
	for (const m of source.matchAll(
		/^(?:pub\s+)?export\s+fn\s+([A-Za-z_][A-Za-z0-9_]*)/gm,
	)) {
		names.add(m[1]);
	}
	return names;
}
