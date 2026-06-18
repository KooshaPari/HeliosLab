/**
 * Live-region announcer for screen readers.
 *
 * HeliosLab renderer mounts two hidden regions once at app start (see
 * `src/renderers/ivde/index.html`): #sr-live (polite, status) and #sr-alert
 * (assertive, errors). This hook returns an `announce()` fn that writes into
 * the appropriate region. Both regions use `aria-atomic="true"` so the entire
 * message is read even if the previous message is still being announced.
 *
 * Usage:
 *   const { announce } = useAnnounce();
 *   announce("File saved", "status");
 *   announce("Build failed", "alert");
 */
import { onCleanup, onMount } from "solid-js";

export type AnnounceLevel = "status" | "alert";

export interface UseAnnounce {
	announce: (message: string, level?: AnnounceLevel) => void;
	cancel: () => void;
}

const POLITE_REGION_ID = "sr-live";
const ALERT_REGION_ID = "sr-alert";

let liveEl: HTMLElement | null = null;
let alertEl: HTMLElement | null = null;

// Track pending setTimeout handles per region so `cancel()` can flush them.
// Without this, a `cancel()` between `writeRegion`'s `textContent = ""` and
// the deferred write would still land the message after the cancel.
const pendingTimers: WeakMap<HTMLElement, ReturnType<typeof setTimeout>> = new WeakMap();

function ensureRegions(): { live: HTMLElement; alert: HTMLElement } | null {
	if (typeof document === "undefined") return null;

	if (!liveEl) liveEl = document.getElementById(POLITE_REGION_ID);
	if (!alertEl) alertEl = document.getElementById(ALERT_REGION_ID);

	if (!liveEl || !alertEl) {
		// Mount a fallback in <body> if index.html didn't include the regions.
		// This makes the hook robust to ad-hoc use in tests / standalone tools.
		if (!liveEl) {
			liveEl = document.createElement("div");
			liveEl.id = POLITE_REGION_ID;
			liveEl.setAttribute("aria-live", "polite");
			liveEl.setAttribute("aria-atomic", "true");
			liveEl.setAttribute("role", "status");
			liveEl.className = "sr-only";
			document.body.appendChild(liveEl);
		}
		if (!alertEl) {
			alertEl = document.createElement("div");
			alertEl.id = ALERT_REGION_ID;
			alertEl.setAttribute("aria-live", "assertive");
			alertEl.setAttribute("aria-atomic", "true");
			alertEl.setAttribute("role", "alert");
			alertEl.className = "sr-only";
			document.body.appendChild(alertEl);
		}
	}
	return { live: liveEl, alert: alertEl };
}

/**
 * Write a message into a live region. Clears the region first so identical
 * successive messages (e.g. "Saved" twice) are still announced.
 */
function writeRegion(el: HTMLElement, message: string) {
	const existing = pendingTimers.get(el);
	if (existing !== undefined) clearTimeout(existing);
	// Clear first so the screen reader re-announces on identical text.
	el.textContent = "";
	// setTimeout(0) forces the DOM mutation to flush before the new text lands.
	const handle = setTimeout(() => {
		el.textContent = message;
		pendingTimers.delete(el);
	}, 16);
	pendingTimers.set(el, handle);
}

export function useAnnounce(): UseAnnounce {
	onMount(() => {
		ensureRegions();
	});

	onCleanup(() => {
		// Regions persist across the app lifetime — do not remove on unmount.
	});

	const announce = (message: string, level: AnnounceLevel = "status") => {
		const regions = ensureRegions();
		if (!regions) return;
		if (level === "alert") {
			writeRegion(regions.alert, message);
		} else {
			writeRegion(regions.live, message);
		}
	};

	const cancel = () => {
		const regions = ensureRegions();
		if (!regions) return;
		for (const el of [regions.live, regions.alert]) {
			const existing = pendingTimers.get(el);
			if (existing !== undefined) {
				clearTimeout(existing);
				pendingTimers.delete(el);
			}
			el.textContent = "";
		}
	};

	return { announce, cancel };
}
