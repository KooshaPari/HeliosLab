// packages/runtime-core/src/a11y/announce.ts
// createAnnouncer — a Solid primitive that mounts a singleton live region
// and returns an `announce(message, level)` function. The first call lazily
// inserts the live region into document.body; subsequent calls just update
// its text content. `level` is "polite" (default) for status updates and
// "assertive" for errors.
//
// Mirrors the React useAnnounce hook from OmniRoute-3rd, adapted to Solid's
// createSignal/createEffect model. Used by both apps/desktop and apps/runtime
// (colab-renderer does its own xterm screenReaderMode — see TerminalPanel).

import { createEffect, createSignal, onCleanup } from "solid-js";

export type AnnounceLevel = "polite" | "assertive";

export interface Announcer {
  announce(message: string, level?: AnnounceLevel): void;
}

const REGION_ID = "sr-live";
const ALERT_ID = "sr-alert";

function ensureRegion(id: string, role: string, live: AnnounceLevel): void {
  if (typeof document === "undefined") return;
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement("div");
    el.id = id;
    el.setAttribute("role", role);
    el.setAttribute("aria-live", live);
    el.setAttribute("aria-atomic", "true");
    el.className = "sr-only";
    document.body.appendChild(el);
  }
}

export function createAnnouncer(options?: { persist?: boolean }): Announcer {
  const [statusMsg, setStatusMsg] = createSignal<string>("");
  const [alertMsg, setAlertMsg] = createSignal<string>("");

  // Mount on first browser tick; SSR-safe.
  if (typeof document !== "undefined") {
    queueMicrotask(() => {
      ensureRegion(REGION_ID, "status", "polite");
      ensureRegion(ALERT_ID, "alert", "assertive");
    });
  }

  createEffect(() => {
    const polite = statusMsg();
    if (polite && typeof document !== "undefined") {
      const el = document.getElementById(REGION_ID);
      if (el) el.textContent = polite;
    }
  });

  createEffect(() => {
    const err = alertMsg();
    if (err && typeof document !== "undefined") {
      const el = document.getElementById(ALERT_ID);
      if (el) el.textContent = err;
    }
  });

  if (!options?.persist) {
    onCleanup(() => {
      if (typeof document === "undefined") return;
      document.getElementById(REGION_ID)?.remove();
      document.getElementById(ALERT_ID)?.remove();
    });
  }

  return {
    announce(message: string, level: AnnounceLevel = "polite") {
      if (level === "assertive") setAlertMsg(message);
      else setStatusMsg(message);
    },
  };
}

// Module-level singleton so non-component code (stores, event handlers) can
// announce without prop-drilling the hook result. Initialized on first call
// to `getAnnouncer()`.
let _instance: Announcer | null = null;
export function getAnnouncer(): Announcer {
  if (!_instance) _instance = createAnnouncer({ persist: true });
  return _instance;
}
