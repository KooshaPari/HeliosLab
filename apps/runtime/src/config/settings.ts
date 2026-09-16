import { getAllDefaults, validateValue } from "./schema.js";
import type {
	SettingChangeEvent,
	SettingsSchema,
	SettingsStore,
} from "./types.js";

type BusPublishFn = (topic: string, payload: SettingChangeEvent) => void;
type ChangeListener = (event: SettingChangeEvent) => void;

/**
 * Primary settings interface with validation, change detection,
 * hot-reload propagation, and restart-required tracking.
 */
export class SettingsManager {
	private readonly schema: SettingsSchema;
	private readonly store: SettingsStore;
	private readonly busPublish: BusPublishFn | undefined;

	private cache: Record<string, unknown> = {};
	private listeners: Set<ChangeListener> = new Set();
	private changedRestartKeys: Set<string> = new Set();
	private unwatch: (() => void) | undefined;

	constructor(
		schema: SettingsSchema,
		store: SettingsStore,
		busPublish?: BusPublishFn,
	) {
		this.schema = schema;
		this.store = store;
		this.busPublish = busPublish;
	}

	/** Load persisted values, fill missing keys from defaults, wire file watch. */
	async init(): Promise<void> {
		const defaults = getAllDefaults();
		const persisted = await this.store.load();
		this.cache = { ...defaults, ...persisted };

		// Wire external-edit detection.
		this.unwatch = this.store.watch(() => {
			void this.handleExternalChange();
		});
	}

	/** Get a single setting value from in-memory cache. */
	get(key: string): unknown {
		if (key in this.cache) {
			return this.cache[key];
		}
		// Fall back to schema default.
		const def = this.schema[key];
		return def?.default;
	}

	/** Set a setting value. Validates, persists, emits events. */
	async set(key: string, value: unknown): Promise<SettingChangeEvent> {
		const def = this.schema[key];

		// Only validate keys that are in the schema.
		if (def) {
			const result = validateValue(key, value);
			if (!result.valid) {
				throw new Error(result.reason ?? `Invalid value for ${key}`);
			}
		}

		const oldValue: unknown = this.cache[key];
		this.cache[key] = value;
		await this.store.save(this.cache);

		const event: SettingChangeEvent = {
			key,
			oldValue,
			newValue: value,
			reloadPolicy: def?.reloadPolicy ?? "hot",
		};

		this.emitChange(event);
		return event;
	}

	/** Return full settings snapshot (known keys only). */
	getAll(): Record<string, unknown> {
		return { ...this.cache };
	}

	/** Reset a key to its schema default. */
	async reset(key: string): Promise<SettingChangeEvent> {
		const def = this.schema[key];
		const defaultVal: unknown = def?.default;
		return this.set(key, defaultVal);
	}

	/** Subscribe to all setting changes. Returns unsubscribe function. */
	onSettingChanged(callback: ChangeListener): () => void {
		this.listeners.add(callback);
		return () => {
			this.listeners.delete(callback);
		};
	}

	/** True if any restart-required setting has changed since startup. */
	isRestartRequired(): boolean {
		return this.changedRestartKeys.size > 0;
	}

	/** List keys of changed restart-required settings. */
	getChangedRestartSettings(): string[] {
		return [...this.changedRestartKeys];
	}

	/** Tear down file watcher. */
	dispose(): void {
		this.unwatch?.();
	}

	// ── Private helpers ───────────────────────────────────────────────────

	private emitChange(event: SettingChangeEvent): void {
		const def = this.schema[event.key];

		if (def?.reloadPolicy === "restart") {
			this.changedRestartKeys.add(event.key);
			// No bus event for restart-required settings.
		} else {
			// Hot-reloadable → publish on bus if available.
			try {
				this.busPublish?.("settings.changed", event);
			} catch {
				console.warn("[settings] Bus publish failed, skipping event emission.");
			}
		}

		// Always notify direct subscribers regardless of reload policy.
		for (const listener of this.listeners) {
			listener(event);
		}
	}

	private async handleExternalChange(): Promise<void> {
		const persisted = await this.store.load();
		const defaults = getAllDefaults();
		const merged = { ...defaults, ...persisted };

		for (const key of Object.keys(merged)) {
			const oldValue = this.cache[key];
			const newValue = merged[key];
			if (oldValue !== newValue) {
				this.cache[key] = newValue;
				const def = this.schema[key];
				const event: SettingChangeEvent = {
					key,
					oldValue,
					newValue,
					reloadPolicy: def?.reloadPolicy ?? "hot",
				};
				this.emitChange(event);
			}
		}
	}
}
