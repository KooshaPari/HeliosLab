/** Whether a setting change takes effect immediately or requires restart. */
export type ReloadPolicy = "hot" | "restart";

/** Supported setting value types. */
export type SettingType = "string" | "number" | "boolean" | "enum";

/** Metadata for a single setting. */
export interface SettingDefinition {
  key: string;
  type: SettingType;
  default: unknown;
  description: string;
  reloadPolicy: ReloadPolicy;
  validation?: (value: unknown) => boolean;
  enumValues?: readonly string[];
}

/** Map of setting keys to their definitions. */
export type SettingsSchema = Record<string, SettingDefinition>;

/** Emitted when a setting value changes. */
export interface SettingChangeEvent {
  key: string;
  oldValue: unknown;
  newValue: unknown;
  reloadPolicy: ReloadPolicy;
}

/** Backend-agnostic persistence interface. */
export interface SettingsStore {
  load(): Promise<Record<string, unknown>>;
  save(values: Record<string, unknown>): Promise<void>;
  watch(callback: () => void): () => void;
}
