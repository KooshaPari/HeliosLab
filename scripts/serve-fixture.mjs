/**
 * scripts/serve-fixture.mjs — minimal static HTTP server used by the a11y
 * Playwright suite to serve `tests/fixtures/`. This avoids the chicken-and-
 * egg of `bun run dev` (electrobun) not exposing an HTTP port while still
 * keeping the e2e specs realistic (real HTTP, real Chromium, real axe).
 *
 * Usage: bun run scripts/serve-fixture.mjs [--port 5173] [--root tests/fixtures]
 */
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";

const args = process.argv.slice(2);
const getArg = (name, fallback) => {
	const i = args.indexOf(name);
	if (i === -1) return fallback;
	return args[i + 1] ?? fallback;
};

const PORT = Number(getArg("--port", process.env.PORT ?? 5173));
const HOST = getArg("--host", process.env.HOST ?? "127.0.0.1");
const ROOT = resolve(getArg("--root", "tests/fixtures"));

const MIME = {
	".html": "text/html; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".js": "application/javascript; charset=utf-8",
	".mjs": "application/javascript; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".svg": "image/svg+xml",
	".png": "image/png",
	".ico": "image/x-icon",
};

const server = createServer(async (req, res) => {
	try {
		const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
		let path = decodeURIComponent(url.pathname);
		if (path === "/" || path === "") path = "/workbench.html";
		const full = normalize(join(ROOT, path));
		if (!full.startsWith(ROOT)) {
			res.writeHead(403);
			res.end("Forbidden");
			return;
		}
		const st = await stat(full).catch(() => null);
		if (!st || !st.isFile()) {
			res.writeHead(404);
			res.end("Not Found");
			return;
		}
		const body = await readFile(full);
		const type = MIME[extname(full)] ?? "application/octet-stream";
		res.writeHead(200, { "content-type": type, "content-length": body.length });
		res.end(body);
	} catch (err) {
		res.writeHead(500);
		res.end(String(err));
	}
});

server.listen(PORT, HOST, () => {
	console.log(`[serve-fixture] http://${HOST}:${PORT} -> ${ROOT}`);
});
