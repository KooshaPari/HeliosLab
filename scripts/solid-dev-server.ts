// scripts/solid-dev-server.ts
// Dev entry used by app `dev` scripts. With `--port`, serves the Solid client
// over HTTP for Playwright/a11y gates; without `--port`, runs the Bun backend.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { solidPlugin } from "esbuild-plugin-solid";

function parsePort(): number | null {
  const idx = process.argv.indexOf("--port");
  if (idx === -1) return null;
  const value = process.argv[idx + 1];
  return value ? Number.parseInt(value, 10) : null;
}

const port = parsePort();
const appRoot = process.cwd();

if (!port) {
  await import(join(appRoot, "src/index.ts"));
} else {
  const clientEntry = existsSync(join(appRoot, "src/client.tsx"))
    ? join(appRoot, "src/client.tsx")
    : join(appRoot, "src/index.tsx");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Helios</title>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/client.js"></script>
</body>
</html>`;

  // Playwright runs route checks in parallel. Share one build per app process so
  // concurrent /client.js requests cannot launch overlapping esbuild pipelines.
  const clientBundle = Bun.build({
    entrypoints: [clientEntry],
    target: "browser",
    format: "esm",
    plugins: [solidPlugin()],
    define: { "process.env.NODE_ENV": JSON.stringify("development") },
  }).then(async result => ({
    success: result.success,
    body: result.success
      ? await result.outputs[0]!.text()
      : result.logs.map(log => String(log.message)).join("\n"),
  }));

  Bun.serve({
    port,
    async fetch(req) {
      const { pathname } = new URL(req.url);

      if (pathname === "/client.js") {
        const bundle = await clientBundle;
        if (!bundle.success) {
          return new Response(bundle.body, { status: 500 });
        }
        return new Response(bundle.body, {
          headers: { "Content-Type": "application/javascript" },
        });
      }

      if (!pathname.includes(".")) {
        return new Response(html, {
          headers: { "Content-Type": "text/html" },
        });
      }

      return new Response("Not Found", { status: 404 });
    },
  });

  console.log(`[dev] listening on http://localhost:${port}`);
}
