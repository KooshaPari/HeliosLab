/**
 * Renderer registry (minimal version for rio adapter registration).
 */

import type { RendererAdapter } from "./adapter.js";
import type { RendererCapabilities } from "./capabilities.js";

export interface RegistrationMeta {
	id: string;
	version: string;
	registeredAt: number;
	capabilities: RendererCapabilities;
}

export class DuplicateRendererError extends Error {
	constructor(id: string) {
		super(`Renderer "${id}" is already registered`);
		this.name = "DuplicateRendererError";
	}
}

export class RendererNotFoundError extends Error {
	constructor(id: string) {
		super(`Renderer "${id}" is not registered`);
		this.name = "RendererNotFoundError";
	}
}

export class RendererRegistry {
	private readonly _adapters = new Map<string, RendererAdapter>();
	private readonly _meta = new Map<string, RegistrationMeta>();
	private _activeId: string | undefined;

	register(adapter: RendererAdapter): void {
		if (this._adapters.has(adapter.id)) {
			throw new DuplicateRendererError(adapter.id);
		}
		this._adapters.set(adapter.id, adapter);
		this._meta.set(adapter.id, {
			id: adapter.id,
			version: adapter.version,
			registeredAt: Date.now(),
			capabilities: adapter.queryCapabilities(),
		});
	}

	unregister(id: string): void {
		if (!this._adapters.has(id)) {
			throw new RendererNotFoundError(id);
		}
		if (this._activeId === id) {
			this._activeId = undefined;
		}
		this._adapters.delete(id);
		this._meta.delete(id);
	}

	get(id: string): RendererAdapter | undefined {
		return this._adapters.get(id);
	}

	list(): RendererAdapter[] {
		return [...this._adapters.values()];
	}

	getActive(): RendererAdapter | undefined {
		return this._activeId !== undefined
			? this._adapters.get(this._activeId)
			: undefined;
	}

	setActive(id: string): void {
		if (!this._adapters.has(id)) {
			throw new RendererNotFoundError(id);
		}
		this._activeId = id;
	}

	clearActive(): void {
		this._activeId = undefined;
	}

	getCapabilities(id: string): RendererCapabilities {
		const meta = this._meta.get(id);
		if (meta === undefined) {
			throw new RendererNotFoundError(id);
		}
		return meta.capabilities;
	}
}
