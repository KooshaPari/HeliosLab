// apps/runtime/src/index.tsx
// Runtime entry — same SkipLink + DirProvider pattern as the desktop app.
// The runtime app is the headless/CLI-adjacent dashboard; it shares the
// announce() primitive and dir handling from @helios/runtime-core.

import { type Component, onMount } from "solid-js";
import { getAnnouncer } from "../../../packages/runtime-core/src/a11y/announce.js";
import { DirProvider } from "../../desktop/src/a11y/DirProvider.js";
import { SkipLink } from "./a11y/SkipLink.js";

export const App: Component = () => {
	onMount(() => {
		getAnnouncer();
	});

	return (
		<DirProvider>
			<SkipLink />
			<main id="main" tabindex="-1">
				{/* Runtime dashboard content */}
			</main>
		</DirProvider>
	);
};

export default App;
