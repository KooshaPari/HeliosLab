// scripts/solid-dev-server.ts
// Dev entry used by app `dev` scripts. With `--port`, serves the Solid client
// over HTTP for Playwright/a11y gates; without `--port`, runs the Bun backend.

import { existsSync, readFileSync, readdirSync, watch } from "node:fs";
import { timingSafeEqual } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { solidPlugin } from "esbuild-plugin-solid";

function parseOption(name: string): string | null {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return null;
  return process.argv[idx + 1] ?? null;
}

function findWorkspaceRoot(start: string): string {
  let current = resolve(start);
  while (true) {
    const packagePath = join(current, "package.json");
    if (existsSync(packagePath)) {
      const packageJson = JSON.parse(readFileSync(packagePath, "utf8")) as {
        workspaces?: unknown;
      };
      if (Array.isArray(packageJson.workspaces)) return current;
    }
    const parent = dirname(current);
    if (parent === current) return resolve(start);
    current = parent;
  }
}

function getWorkspaceDirectories(workspaceRoot: string): string[] {
  const packageJson = JSON.parse(readFileSync(join(workspaceRoot, "package.json"), "utf8")) as {
    workspaces?: string[] | { packages?: string[] };
  };
  const patterns = Array.isArray(packageJson.workspaces)
    ? packageJson.workspaces
    : packageJson.workspaces?.packages ?? [];
  const directories = new Set<string>();

  for (const pattern of patterns) {
    if (pattern.endsWith("/*")) {
      const parent = resolve(workspaceRoot, pattern.slice(0, -2));
      if (!existsSync(parent)) continue;
      for (const entry of readdirSync(parent, { withFileTypes: true })) {
        if (entry.isDirectory()) directories.add(join(parent, entry.name));
      }
      continue;
    }
    if (pattern.includes("*")) continue;
    const directory = resolve(workspaceRoot, pattern);
    if (existsSync(directory)) directories.add(directory);
  }

  return [...directories];
}

const portValue = parseOption("--port");
const port = portValue ? Number.parseInt(portValue, 10) : null;
const appRoot = resolve(parseOption("--app-root") ?? process.cwd());
const workspaceRoot = resolve(
  parseOption("--workspace-root") ?? findWorkspaceRoot(appRoot)
);
const shutdownToken = process.env.HELIOS_DEV_SHUTDOWN_TOKEN;

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
  <script>
    const reloadEvents = new EventSource("/__helios_reload");
    reloadEvents.addEventListener("reload", () => location.reload());
  </script>
</body>
</html>`;

  const encoder = new TextEncoder();
  const reloadClients = new Set<ReadableStreamDefaultController<Uint8Array>>();
  let reloadTimer: ReturnType<typeof setTimeout> | undefined;

  const signalReload = () => {
    if (reloadTimer !== undefined) clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => {
      const message = encoder.encode(`event: reload\ndata: ${Date.now()}\n\n`);
      for (const client of reloadClients) {
        try {
          client.enqueue(message);
        } catch {
          reloadClients.delete(client);
        }
      }
    }, 50);
  };

  const workspaceWatchers = getWorkspaceDirectories(workspaceRoot).map(directory =>
    watch(directory, { recursive: true }, (_event, filename) => {
      const path = String(filename ?? "");
      if (path.includes("node_modules") || path.includes(".git") || path.includes("dist")) {
        return;
      }
      signalReload();
    })
  );

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port,
    async fetch(req) {
      const url = new URL(req.url);
      const { pathname } = url;

      if (pathname === "/__helios_shutdown") {
        if (shutdownToken === undefined) return new Response("Not Found", { status: 404 });
        if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
        const address = server.requestIP(req)?.address;
        const loopback =
          address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
        const suppliedToken = req.headers.get("X-Helios-Shutdown-Token");
        const expected = new TextEncoder().encode(shutdownToken);
        const supplied = new TextEncoder().encode(suppliedToken ?? "");
        const authenticated = supplied.length === expected.length && timingSafeEqual(supplied, expected);
        if (!loopback || !authenticated) return new Response("Forbidden", { status: 403 });

        setTimeout(() => {
          if (reloadTimer !== undefined) clearTimeout(reloadTimer);
          for (const watcher of workspaceWatchers) watcher.close();
          void server.stop(true);
        }, 0);
        return new Response("Shutting down", { status: 202 });
      }

      if (pathname === "/__helios_reload") {
        let client: ReadableStreamDefaultController<Uint8Array> | undefined;
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            client = controller;
            reloadClients.add(controller);
            controller.enqueue(encoder.encode(": connected\n\n"));
          },
          cancel() {
            if (client) reloadClients.delete(client);
          },
        });
        req.signal.addEventListener("abort", () => {
          if (client) reloadClients.delete(client);
        });
        return new Response(stream, {
          headers: {
            "Cache-Control": "no-cache",
            "Content-Type": "text/event-stream",
            Connection: "keep-alive",
          },
        });
      }

      if (pathname === "/client.js") {
        const result = await Bun.build({
          entrypoints: [clientEntry],
          target: "browser",
          format: "esm",
          plugins: [solidPlugin()],
          define: { "process.env.NODE_ENV": JSON.stringify("development") },
        });
        if (!result.success) {
          return new Response(result.logs.map(log => String(log.message)).join("\n"), {
            status: 500,
          });
        }
        return new Response(await result.outputs[0]?.text(), {
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
