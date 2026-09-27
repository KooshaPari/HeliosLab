// Minimal store-only ZIP writer, so the test builds a real zip on every
// platform without depending on a `zip` binary or on `tar -a`. GNU tar on
// the Linux runners ignores `-a` for a `.zip` suffix and writes a TAR,
// while bsdtar on macOS and Windows honours it and writes a real ZIP, so
// the old fixture passed locally and failed in CI.
//
// Store-only (no deflate) is valid ZIP and keeps this dependency-free;
// `unzip -o -q` reads it exactly as it reads a deflated archive.
//
// Intentionally outside `tsc` coverage: the root tsconfig includes only
// apps/*/src and packages/*/src, so `bun run typecheck` never loads this
// file, and `bun test` transpiles without checking types. The annotations
// below are therefore checked by hand, via
//   tsc --noEmit --strict --skipLibCheck --target es2022 \
//       --module esnext --moduleResolution bundler scripts/tests/helpers/make-zip.ts
// which is clean, and which reports TS7006 on both functions if the
// parameter types are removed. Do not assume CI will catch a regression
// here.
const CRC_TABLE = (() => {
	const table = new Int32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		table[n] = c;
	}
	return table;
})();

function crc32(buf: Uint8Array): number {
	let c = 0xffffffff;
	for (let i = 0; i < buf.length; i++)
		c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}

/**
 * Build a ZIP archive from `entries` (filename -> string | Uint8Array).
 * Returns the archive bytes.
 */
export function makeZip(
	entries: Record<string, string | Uint8Array>,
): Uint8Array {
	const encoder = new TextEncoder();
	const locals: Uint8Array[] = [];
	const centrals: Uint8Array[] = [];
	let offset = 0;

	for (const [name, value] of Object.entries(entries)) {
		const nameBytes = encoder.encode(name);
		const data =
			typeof value === "string" ? encoder.encode(value) : new Uint8Array(value);
		const crc = crc32(data);

		// Local file header
		const local = new Uint8Array(30 + nameBytes.length);
		const lv = new DataView(local.buffer);
		lv.setUint32(0, 0x04034b50, true); // local header signature
		lv.setUint16(4, 20, true); // version needed
		lv.setUint16(6, 0, true); // flags
		lv.setUint16(8, 0, true); // method: store
		lv.setUint16(10, 0, true); // mod time
		lv.setUint16(12, 0x21, true); // mod date (1980-01-01)
		lv.setUint32(14, crc, true);
		lv.setUint32(18, data.length, true); // compressed size
		lv.setUint32(22, data.length, true); // uncompressed size
		lv.setUint16(26, nameBytes.length, true);
		lv.setUint16(28, 0, true); // extra length
		local.set(nameBytes, 30);
		locals.push(local, data);

		// Central directory entry
		const central = new Uint8Array(46 + nameBytes.length);
		const cv = new DataView(central.buffer);
		cv.setUint32(0, 0x02014b50, true); // central header signature
		cv.setUint16(4, 20, true); // version made by
		cv.setUint16(6, 20, true); // version needed
		cv.setUint16(8, 0, true); // flags
		cv.setUint16(10, 0, true); // method: store
		cv.setUint16(12, 0, true); // mod time
		cv.setUint16(14, 0x21, true); // mod date
		cv.setUint32(16, crc, true);
		cv.setUint32(20, data.length, true);
		cv.setUint32(24, data.length, true);
		cv.setUint16(28, nameBytes.length, true);
		cv.setUint16(30, 0, true); // extra
		cv.setUint16(32, 0, true); // comment
		cv.setUint16(34, 0, true); // disk number
		cv.setUint16(36, 0, true); // internal attrs
		cv.setUint32(38, 0, true); // external attrs
		cv.setUint32(42, offset, true); // relative offset of local header
		central.set(nameBytes, 46);
		centrals.push(central);

		offset += local.length + data.length;
	}

	const centralSize = centrals.reduce((n, c) => n + c.length, 0);
	const end = new Uint8Array(22);
	const ev = new DataView(end.buffer);
	ev.setUint32(0, 0x06054b50, true); // end of central directory
	ev.setUint16(4, 0, true);
	ev.setUint16(6, 0, true);
	ev.setUint16(8, centrals.length, true);
	ev.setUint16(10, centrals.length, true);
	ev.setUint32(12, centralSize, true);
	ev.setUint32(16, offset, true);
	ev.setUint16(20, 0, true);

	const parts = [...locals, ...centrals, end];
	const total = parts.reduce((n, p) => n + p.length, 0);
	const out = new Uint8Array(total);
	let at = 0;
	for (const p of parts) {
		out.set(p, at);
		at += p.length;
	}
	return out;
}
