/**
 * Headless recording renderer adapter.
 *
 * A real {@link RendererAdapter} implementation that performs no GPU work.
 * It decodes the byte stream bound to each PTY and records it as ordered
 * "cells" so that CI, headless mode, and the terminal-first vertical slice
 * can assert that PTY output actually reaches a renderer surface.
 *
 * Unlike the mock adapter in the renderer unit tests, this is a production
 * artifact: it is the adapter a headless or test run should use whenever a
 * concrete renderer backend is not present.
 *
 * @module
 */

import type {
	RendererAdapter,
	RendererConfig,
	RendererState,
	RenderSurface,
} from "./adapter.js";
import type { RendererCapabilities } from "./capabilities.js";

/** A single recorded chunk of decoded terminal output. */
export interface RecordedCell {
	/** PTY that produced this cell. */
	ptyId: string;
	/** Zero-based index of this cell within its PTY's recording. */
	index: number;
	/** Raw bytes received for this cell. */
	bytes: Uint8Array;
	/** UTF-8 text decoded from {@link bytes}. */
	text: string;
	/** Monotonic sequence number across every PTY, in arrival order. */
	sequence: number;
}

/** Construction options for {@link RecordingRendererAdapter}. */
export interface RecordingAdapterOptions {
	id?: string;
	version?: string;
	maxDimensions?: { cols: number; rows: number };
}

const DEFAULT_MAX_DIMENSIONS = { cols: 200, rows: 50 };

/**
 * Renderer adapter that records PTY output instead of drawing it.
 *
 * Bound streams are drained eagerly; {@link unbindStream} cancels the read so
 * a PTY's cell count freezes the moment it is detached.
 */
export class RecordingRendererAdapter implements RendererAdapter {
	public readonly id: string;
	public readonly version: string;

	private state: RendererState = "uninitialized";
	private surface: RenderSurface | null = null;
	private config: RendererConfig | null = null;
	private disposed = false;
	private sequenceCounter = 0;

	private readonly defaultMaxDimensions: { cols: number; rows: number };
	private readonly streams = new Map<string, ReadableStream<Uint8Array>>();
	private readonly readers = new Map<
		string,
		ReadableStreamDefaultReader<Uint8Array>
	>();
	private readonly cellsByPty = new Map<string, RecordedCell[]>();
	private readonly crashHandlers: Array<(error: Error) => void> = [];

	constructor(options: RecordingAdapterOptions = {}) {
		this.id = options.id ?? "recording";
		this.version = options.version ?? "1.0.0";
		this.defaultMaxDimensions = options.maxDimensions ?? DEFAULT_MAX_DIMENSIONS;
	}

	async init(config: RendererConfig): Promise<void> {
		this.state = "initializing";
		this.config = config;
		this.state = "running";
	}

	async start(surface: RenderSurface): Promise<void> {
		this.surface = surface;
		if (this.state === "uninitialized") {
			this.state = "running";
		}
	}

	async stop(): Promise<void> {
		this.state = "stopping";
		this.disposed = true;
		for (const ptyId of [...this.streams.keys()]) {
			this.unbindStream(ptyId);
		}
		this.state = "stopped";
	}

	bindStream(ptyId: string, stream: ReadableStream<Uint8Array>): void {
		this.unbindStream(ptyId);
		this.streams.set(ptyId, stream);
		const reader = stream.getReader();
		this.readers.set(ptyId, reader);
		void this.consume(ptyId, reader);
	}

	unbindStream(ptyId: string): void {
		const reader = this.readers.get(ptyId);
		this.readers.delete(ptyId);
		this.streams.delete(ptyId);
		if (reader) {
			// Cancel the read so no further cells are recorded for this PTY.
			void reader.cancel().catch(() => {});
		}
	}

	handleInput(_ptyId: string, _data: Uint8Array): void {
		// A recording surface has no input path; input is injected upstream.
	}

	resize(_ptyId: string, _cols: number, _rows: number): void {
		// No viewport to resize headlessly.
	}

	queryCapabilities(): RendererCapabilities {
		return {
			gpuAccelerated: false,
			colorDepth: 24,
			ligatureSupport: false,
			maxDimensions: this.config?.maxDimensions ?? this.defaultMaxDimensions,
			inputModes: ["raw"],
			sixelSupport: false,
			italicSupport: false,
			strikethroughSupport: false,
		};
	}

	getState(): RendererState {
		return this.state;
	}

	onCrash(handler: (error: Error) => void): void {
		this.crashHandlers.push(handler);
	}

	// ── Recording surface ─────────────────────────────────────────────────────

	/** Every recorded cell across all PTYs, in arrival order. */
	get cells(): readonly RecordedCell[] {
		return [...this.cellsByPty.values()]
			.flat()
			.sort((a, b) => a.sequence - b.sequence);
	}

	/** Recorded cells for one PTY, in arrival order. */
	cellsFor(ptyId: string): readonly RecordedCell[] {
		return this.cellsByPty.get(ptyId) ?? [];
	}

	/** Concatenated UTF-8 text recorded for one PTY. */
	textFor(ptyId: string): string {
		return this.cellsFor(ptyId)
			.map((cell) => cell.text)
			.join("");
	}

	/** The surface passed to {@link start}, if any. */
	get activeSurface(): RenderSurface | null {
		return this.surface;
	}

	/** PTY IDs that currently have a bound stream. */
	get boundPtyIds(): readonly string[] {
		return [...this.streams.keys()];
	}

	/**
	 * Resolve once `ptyId` has recorded text containing `needle`.
	 *
	 * @returns `true` if the needle was observed before `timeoutMs` elapsed.
	 */
	async waitForText(
		ptyId: string,
		needle: string,
		timeoutMs = 5000,
	): Promise<boolean> {
		const deadline = Date.now() + timeoutMs;
		for (;;) {
			if (this.textFor(ptyId).includes(needle)) return true;
			if (Date.now() >= deadline) return false;
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
	}

	private async consume(
		ptyId: string,
		reader: ReadableStreamDefaultReader<Uint8Array>,
	): Promise<void> {
		try {
			for (;;) {
				const { done, value } = await reader.read();
				if (done || this.disposed) break;
				if (value && value.byteLength > 0) {
					this.record(ptyId, value);
				}
			}
		} catch (error) {
			const err = error instanceof Error ? error : new Error(String(error));
			for (const handler of this.crashHandlers) {
				handler(err);
			}
		} finally {
			try {
				reader.releaseLock();
			} catch {
				// Reader was already cancelled or released.
			}
		}
	}

	private record(ptyId: string, bytes: Uint8Array): void {
		let cells = this.cellsByPty.get(ptyId);
		if (!cells) {
			cells = [];
			this.cellsByPty.set(ptyId, cells);
		}
		this.sequenceCounter += 1;
		cells.push({
			ptyId,
			index: cells.length,
			bytes,
			text: new TextDecoder().decode(bytes),
			sequence: this.sequenceCounter,
		});
	}
}
