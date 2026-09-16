import type { track } from "../../main/utils/analytics";
import { electrobun } from "./init";

export const trackFrontend = <T extends keyof typeof track>(
	event: T,
	properties: Parameters<(typeof track)[T]>[0],
) => {
	electrobun.rpc?.send("track", {
		event,
		properties,
	});
};

// todo: add app settings with tracking level toggle
// todo: add log that queries backend for the last 100 events and displays it in the window
