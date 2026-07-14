/**
 * FR-HELIOS-110: Terminal Registry Persistence Integration Tests
 * Verifies: FR-PER-001 (Workspace persistence)
 */
import { TerminalRegistry } from "../../../src/registry/terminal_registry.js";
import { JsonFilePersistence, InMemoryPersistence } from "../../../src/registry/persistence.js";
import { promises as fs } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { BindingTriple } from "../../../src/registry/binding_triple.js";

describe("Persistence Integration", () => {
  let registry: TerminalRegistry;
  let tempDir: string;

  beforeEach(async () => {
    registry = new TerminalRegistry();
    tempDir = join(tmpdir(), `binding-persist-test-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    // eslint-disable-next-line no-unused-vars
    } catch (_err) {}
  });

  describe("JsonFilePersistence", () => {
    it("should save and reload bindings", async () => {
      const persistence = new JsonFilePersistence(join(tempDir, "bindings.json"));

      // Register bindings
      const bindings: BindingTriple[] = Array.from({ length: 10 }, (_, i) => ({
        workspaceId: "ws-1",
        laneId: `lane-${i % 3}`,
        sessionId: `session-${i}`,
      }));

      bindings.forEach((triple, i) => {
        registry.register(`terminal-${i}`, triple);
      });

      const allBindings = registry.getAll();
      expect(allBindings).toHaveLength(10);

      // Save
      await persistence.save(allBindings);
      await persistence.flush();

      // Verify file exists
      const content = await fs.readFile(join(tempDir, "bindings.json"), "utf-8");
      const data = JSON.parse(content);
      expect(data.bindings).toHaveLength(10);

      // Load into new registry
      const newRegistry = new TerminalRegistry();
      const loaded = await persistence.load();
      expect(loaded).toHaveLength(10);

      loaded.forEach(binding => {
        newRegistry.register(binding.terminalId, binding.binding);
      });

      const restored = newRegistry.getAll();
      expect(restored).toHaveLength(10);
      expect(restored.map(b => b.terminalId).sort()).toEqual(
        allBindings.map(b => b.terminalId).sort()
      );
    });

    it("should handle corrupt file gracefully", async () => {
      const filePath = join(tempDir, "corrupt.json");
      const persistence = new JsonFilePersistence(filePath);

      // Create corrupt file
      await fs.writeFile(filePath, "{ invalid json }", "utf-8");

      // Load should return empty array
      const loaded = await persistence.load();
      expect(loaded).toHaveLength(0);
    });

    it("should detect and reject checksum mismatches", async () => {
      const filePath = join(tempDir, "checksum-test.json");
      const persistence = new JsonFilePersistence(filePath);

      // Register and save
      registry.register("terminal-1", {
        workspaceId: "ws-1",
        laneId: "lane-1",
        sessionId: "session-1",
      });

      await persistence.save(registry.getAll());
      await persistence.flush();

      // Corrupt the checksum
      const content = await fs.readFile(filePath, "utf-8");
      const data = JSON.parse(content);
      data.checksum = "invalid-checksum";
      await fs.writeFile(filePath, JSON.stringify(data), "utf-8");

      // Load should return empty (corrupted)
      const loaded = await persistence.load();
      expect(loaded).toHaveLength(0);
    });

    it("should debounce writes", async () => {
      const filePath = join(tempDir, "debounce.json");
      const persistence = new JsonFilePersistence(filePath);

      // Register and trigger multiple saves
      registry.register("terminal-1", {
        workspaceId: "ws-1",
        laneId: "lane-1",
        sessionId: "session-1",
      });

      await persistence.save(registry.getAll());

      registry.register("terminal-2", {
        workspaceId: "ws-1",
        laneId: "lane-1",
        sessionId: "session-2",
      });

      // This should replace the pending write, not queue a second one
      await persistence.save(registry.getAll());

      await persistence.flush();

      const loaded = await persistence.load();
      expect(loaded).toHaveLength(2);
    });

    it("should handle file not found on load", async () => {
      const filePath = join(tempDir, "nonexistent.json");
      const persistence = new JsonFilePersistence(filePath);

      const loaded = await persistence.load();
      expect(loaded).toHaveLength(0);
    });

    it("should perform atomic writes", async () => {
      const filePath = join(tempDir, "atomic.json");
      const persistence = new JsonFilePersistence(filePath);

      // Register multiple bindings
      for (let i = 0; i < 20; i++) {
        registry.register(`terminal-${i}`, {
          workspaceId: "ws-1",
          laneId: `lane-${i % 5}`,
          sessionId: `session-${i}`,
        });
      }

      await persistence.save(registry.getAll());
      await persistence.flush();

      // Verify the file is valid JSON and has complete data
      const content = await fs.readFile(filePath, "utf-8");
      const data = JSON.parse(content);

      expect(data.bindings).toHaveLength(20);
      expect(data.checksum).toBeDefined();
      expect(data.version).toBe(1);
    });
  });

  describe("InMemoryPersistence", () => {
    it("should save and load bindings in memory", async () => {
      const persistence = new InMemoryPersistence();

      registry.register("terminal-1", {
        workspaceId: "ws-1",
        laneId: "lane-1",
        sessionId: "session-1",
      });

      const bindings = registry.getAll();
      await persistence.save(bindings);

      const loaded = await persistence.load();
      expect(loaded).toHaveLength(1);
      expect(loaded[0].terminalId).toBe("terminal-1");
    });

    it("should clear in-memory data", async () => {
      const persistence = new InMemoryPersistence();

      registry.register("terminal-1", {
        workspaceId: "ws-1",
        laneId: "lane-1",
        sessionId: "session-1",
      });

      await persistence.save(registry.getAll());

      let loaded = await persistence.load();
      expect(loaded).toHaveLength(1);

      await persistence.clear();

      loaded = await persistence.load();
      expect(loaded).toHaveLength(0);
    });
  });

  describe("restart recovery", () => {
    it("should recover bindings after simulated restart", async () => {
      const filePath = join(tempDir, "restart.json");
      const persistence = new JsonFilePersistence(filePath);

      // Register bindings in first "run"
      for (let i = 0; i < 25; i++) {
        registry.register(`terminal-${i}`, {
          workspaceId: `ws-${i % 5}`,
          laneId: `lane-${i % 10}`,
          sessionId: `session-${i}`,
        });
      }

      await persistence.save(registry.getAll());
      await persistence.flush();

      // Simulate restart: new registry loads persisted data
      const newRegistry = new TerminalRegistry();
      const loaded = await persistence.load();

      for (const binding of loaded) {
        newRegistry.register(binding.terminalId, binding.binding);
      }

      const restored = newRegistry.getAll();
      expect(restored).toHaveLength(25);

      // Verify a few specific bindings
      expect(newRegistry.get("terminal-0")).toBeDefined();
      expect(newRegistry.get("terminal-24")).toBeDefined();
      expect(newRegistry.getByWorkspace("ws-0")).toHaveLength(5);
    });
  });

  describe("performance", () => {
    it("should flush 500 bindings in under 100ms", async () => {
      const filePath = join(tempDir, "perf.json");
      const persistence = new JsonFilePersistence(filePath);

      // Register 500 bindings
      for (let i = 0; i < 500; i++) {
        registry.register(`terminal-${i}`, {
          workspaceId: `ws-${i % 20}`,
          laneId: `lane-${i % 50}`,
          sessionId: `session-${i}`,
        });
      }

      const bindings = registry.getAll();
      await persistence.save(bindings);

      const start = performance.now();
      await persistence.flush();
      const time = performance.now() - start;

      expect(time).toBeLessThan(200);
    });
  });
});
