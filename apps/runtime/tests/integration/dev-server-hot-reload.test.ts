import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../../../..");
async function reservePort(): Promise<number> {
  const server = Bun.serve({ port: 0, fetch: () => new Response("reserved") });
  const port = server.port;
  await server.stop(true);
  return port;
}

test("bun dev reloads the browser when every declared workspace changes (FR-RUN-004)", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "helios-dev-reload-"));
  const desktopRoot = join(fixtureRoot, "apps", "desktop");
  const alphaSource = join(fixtureRoot, "packages", "alpha", "src", "value.ts");
  const betaSource = join(fixtureRoot, "packages", "beta", "src", "value.ts");
  const clientSource = join(desktopRoot, "src", "client.tsx");
  const port = await reservePort();
  const shutdownToken = crypto.randomUUID();
  let child: ReturnType<typeof Bun.spawn> | undefined;
  let stopped = false;

  try {
    await mkdir(join(desktopRoot, "src"), { recursive: true });
    await mkdir(join(fixtureRoot, "packages", "alpha", "src"), { recursive: true });
    await mkdir(join(fixtureRoot, "packages", "beta", "src"), { recursive: true });
    await writeFile(
      join(fixtureRoot, "package.json"),
      JSON.stringify({
        private: true,
        workspaces: ["apps/desktop", "packages/alpha", "packages/beta"],
      })
    );
    await writeFile(join(desktopRoot, "package.json"), JSON.stringify({ private: true }));
    await writeFile(alphaSource, 'export const alpha = "alpha-before";\n');
    await writeFile(betaSource, 'export const beta = "beta-before";\n');
    await writeFile(
      clientSource,
      [
        'import { alpha } from "../../../packages/alpha/src/value.ts";',
        'import { beta } from "../../../packages/beta/src/value.ts";',
        'console.log(alpha, beta, "desktop-before");',
      ].join("\n")
    );

    child = Bun.spawn([
      process.execPath,
      "dev",
      "--",
      "--port",
      String(port),
      "--workspace-root",
      fixtureRoot,
      "--app-root",
      desktopRoot,
    ], {
      cwd: ROOT,
      env: { ...process.env, HELIOS_DEV_SHUTDOWN_TOKEN: shutdownToken },
      stdout: "pipe",
      stderr: "pipe",
    });

    let bundle: Response | undefined;
    for (let attempt = 0; attempt < 30; attempt++) {
      try {
        bundle = await fetch(`http://127.0.0.1:${port}/client.js`);
        if (bundle.ok) break;
      } catch {
        await Bun.sleep(100);
      }
    }
    expect(bundle?.status).toBe(200);
    const initialBundle = await bundle?.text();
    expect(initialBundle).toContain("alpha-before");
    expect(initialBundle).toContain("beta-before");
    expect(initialBundle).toContain("desktop-before");
    expect(initialBundle).not.toContain(shutdownToken);

    const unauthenticatedShutdown = await fetch(
      `http://127.0.0.1:${port}/__helios_shutdown`,
      { method: "POST" }
    );
    expect(unauthenticatedShutdown.status).toBe(403);

    const reloadResponse = await fetch(`http://127.0.0.1:${port}/__helios_reload`);
    expect(reloadResponse.headers.get("content-type")).toContain("text/event-stream");
    const reader = reloadResponse.body?.getReader();
    expect(reader).toBeDefined();
    await reader?.read();

    const workspaceChanges = [
      [alphaSource, 'export const alpha = "alpha-after";\n', "alpha-after"],
      [betaSource, 'export const beta = "beta-after";\n', "beta-after"],
      [clientSource, 'console.log("desktop-after");\n', "desktop-after"],
    ] as const;

    for (const [source, content, expectedBundleText] of workspaceChanges) {
      await writeFile(source, content);
      const reloadChunk = await Promise.race([
        reader!.read(),
        Bun.sleep(3_000).then(() => {
          throw new Error(`dev server did not signal reload for ${source}`);
        }),
      ]);
      expect(new TextDecoder().decode(reloadChunk.value)).toContain("event: reload");

      const rebuilt = await fetch(`http://127.0.0.1:${port}/client.js`);
      const rebuiltText = await rebuilt.text();
      expect(rebuiltText).toContain(expectedBundleText);
      expect(rebuiltText).not.toContain(shutdownToken);
    }

    const shutdown = await fetch(
      `http://127.0.0.1:${port}/__helios_shutdown`,
      { method: "POST", headers: { "X-Helios-Shutdown-Token": shutdownToken } }
    );
    expect(shutdown.status).toBe(202);
    await Promise.race([
      child.exited,
      Bun.sleep(3_000).then(() => {
        throw new Error("root bun dev chain did not terminate cleanly");
      }),
    ]);
    stopped = true;
  } finally {
    if (!stopped) child?.kill();
    if (child) await child.exited;
    await rm(fixtureRoot, { recursive: true, force: true });
  }

  expect(existsSync(fixtureRoot)).toBe(false);
  await expect(fetch(`http://127.0.0.1:${port}/client.js`)).rejects.toThrow();
});
