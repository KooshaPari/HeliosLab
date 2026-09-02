import type { InferenceEngine } from "./engine";

export class EngineRegistry {
  private engines: Map<string, InferenceEngine> = new Map();

  register(engine: InferenceEngine): void {
    this.engines.set(engine.id, engine);
  }

  get(id: string): InferenceEngine | undefined {
    return this.engines.get(id);
  }

  getAll(): InferenceEngine[] {
    return Array.from(this.engines.values());
  }

  async getHealthy(): Promise<InferenceEngine[]> {
    const results: InferenceEngine[] = [];
    for (const engine of this.engines.values()) {
      const status = await engine.healthCheck();
      if (status === "healthy" || status === "degraded") {
        results.push(engine);
      }
    }
    return results;
  }

  unregister(id: string): boolean {
    return this.engines.delete(id);
  }
}
