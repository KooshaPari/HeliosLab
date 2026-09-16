/**
 * Renderer capability types.
 */

export interface RendererCapabilities {
	gpuAccelerated: boolean;
	colorDepth: 8 | 16 | 24;
	ligatureSupport: boolean;
	maxDimensions: { cols: number; rows: number };
	inputModes: ("raw" | "cooked" | "application")[];
	sixelSupport: boolean;
	italicSupport: boolean;
	strikethroughSupport: boolean;
}

export interface CapabilityDiff {
	field: string;
	from: unknown;
	to: unknown;
}

export interface CapabilityComparison {
	equal: boolean;
	differences: CapabilityDiff[];
}

export interface CapabilityQueryable {
	queryCapabilities(): RendererCapabilities;
}

export function queryCapabilities(
	adapter: CapabilityQueryable,
): RendererCapabilities {
	return adapter.queryCapabilities();
}

function sortedJson(val: unknown): string {
	if (Array.isArray(val)) {
		return JSON.stringify([...val].sort());
	}
	return JSON.stringify(val);
}

export function compareCapabilities(
	a: RendererCapabilities,
	b: RendererCapabilities,
): CapabilityComparison {
	const diffs: CapabilityDiff[] = [];
	for (const key of Object.keys(a) as (keyof RendererCapabilities)[]) {
		const va = a[key];
		const vb = b[key];
		if (sortedJson(va) !== sortedJson(vb)) {
			diffs.push({ field: key, from: va, to: vb });
		}
	}
	return { equal: diffs.length === 0, differences: diffs };
}
