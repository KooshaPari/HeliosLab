#!/usr/bin/env bun
/**
 * HeliosLab Native Build Script
 * 
 * Builds all Zig/Rust/Go/Mojo packages and links them for Bun FFI.
 */

import { $ } from "bun";
import { join } from "path";

const ROOT = import.meta.dir;
const PACKAGES = join(ROOT, "../packages");

async function buildZig() {
  console.log("🔧 Building Zig PTY Pool...");
  try {
    await $`cd ${PACKAGES}/pty-pool && zig build -Drelease-fast`;
    console.log("✅ Zig PTY Pool built");
  } catch (e) {
    console.error("❌ Zig build failed:", e.message);
    throw e;
  }
}

async function buildRust() {
  console.log("🔧 Building Rust Persistence...");
  try {
    await $`cd ${PACKAGES}/persistence && cargo build --release`;
    console.log("✅ Rust Persistence built");
  } catch (e) {
    console.error("❌ Rust build failed:", e.message);
    throw e;
  }
}

async function buildGo() {
  console.log("🔧 Building Go Orchestrator...");
  try {
    await $`cd ${PACKAGES}/orchestrator && go build -buildmode=c-shared -o libhelios-orchestrator.so .`;
    console.log("✅ Go Orchestrator built");
  } catch (e) {
    console.error("❌ Go orchestrator build failed:", e.message);
    throw e;
  }

  console.log("🔧 Building Go Device Manager...");
  try {
    await $`cd ${PACKAGES}/device-manager && go build -buildmode=c-shared -o libhelios-device.so .`;
    console.log("✅ Go Device Manager built");
  } catch (e) {
    console.error("❌ Go device manager build failed:", e.message);
    throw e;
  }
}

async function buildMojo() {
  console.log("🔧 Building Mojo Inference Router...");
  try {
    await $`cd ${PACKAGES}/inference/mojo && mojo build inference_router.mojo`;
    console.log("✅ Mojo Inference Router built");
  } catch (e) {
    console.error("❌ Mojo build failed:", e.message);
    console.log("⚠️  Mojo may not be installed. Skipping...");
  }
}

async function main() {
  console.log("🚀 HeliosLab Native Build");
  console.log("========================\n");

  const start = Date.now();

  try {
    // Build in parallel where possible
    await Promise.all([
      buildZig(),
      buildRust(),
      buildGo(),
      buildMojo(),
    ]);

    const elapsed = Date.now() - start;
    console.log(`\n✅ All native packages built in ${elapsed}ms`);
    console.log("\nNext steps:");
    console.log("  1. Run `bun run build` to build TypeScript");
    console.log("  2. Run `bun run dev` to start development");
  } catch (e) {
    console.error("\n❌ Build failed:", e);
    process.exit(1);
  }
}

main();
