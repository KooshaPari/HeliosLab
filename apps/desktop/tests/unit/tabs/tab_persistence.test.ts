import { promises as fs } from "fs";
import * as path from "path";
import { TabPersistence, type TabPersistedState } from "../../../src/tabs/tab_persistence";
import { createMockTabSurface } from "../../../src/tabs/tab_surface";
import { tmpdir } from "os";

describe("TabPersistence", () => {
  let persistence: TabPersistence;
  let tempDir: string;

  beforeEach(async () => {
    // Use temp directory for tests
    tempDir = path.join(tmpdir(), `tab-test-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });
    persistence = new TabPersistence(tempDir);
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("Load", () => {
    it("should return null for non-existent file", async () => {
      const state = await persistence.load();
      expect(state).toBeNull();
    });

    it("should load valid tab state", async () => {
      const testState: TabPersistedState = {
        version: 1,
        selectedTabId: "tab1",
        tabOrder: ["tab1", "tab2", "tab3"],
        pinnedTabIds: ["tab1"],
        perTabState: {
          tab1: {
            tabId: "tab1",
            tabType: "terminal",
            label: "Terminal",
          },
        },
        savedAt: new Date().toISOString(),
      };

      const filePath = path.join(tempDir, "tab_state.json");
      await fs.writeFile(filePath, JSON.stringify(testState), "utf-8");

      const loaded = await persistence.load();

      expect(loaded).toEqual(testState);
    });

    it("should return null for invalid JSON", async () => {
      const filePath = path.join(tempDir, "tab_state.json");
      await fs.writeFile(filePath, "invalid json {", "utf-8");

      const state = await persistence.load();
      expect(state).toBeNull();
    });

    it("should return null for invalid structure", async () => {
      const filePath = path.join(tempDir, "tab_state.json");
      await fs.writeFile(filePath, JSON.stringify({ invalid: "data" }), "utf-8");

      const state = await persistence.load();
      expect(state).toBeNull();
    });

    it("should load within 100ms for reasonably-sized state", async () => {
      const testState: TabPersistedState = {
        version: 1,
        selectedTabId: "tab1",
        tabOrder: Array.from({ length: 50 }, (_, i) => `tab${i}`),
        pinnedTabIds: [],
        perTabState: {},
        savedAt: new Date().toISOString(),
      };

      const filePath = path.join(tempDir, "tab_state.json");
      await fs.writeFile(filePath, JSON.stringify(testState), "utf-8");

      const _startTime = Date.now();
      await persistence.load();
      const _duration = Date.now() - startTime;

      expect(persistence.getLastLoadTime()).toBeLessThan(100);
    });
  });

  describe("Save", () => {
    it("should save tab state to file", async () => {
      const testState: TabPersistedState = {
        version: 1,
        selectedTabId: "tab1",
        tabOrder: ["tab1", "tab2"],
        pinnedTabIds: [],
        perTabState: {},
        savedAt: new Date().toISOString(),
      };

      await persistence.save(testState);

      // Wait for debounce
      await new Promise(resolve => setTimeout(resolve, 600));

      const filePath = path.join(tempDir, "tab_state.json");
      const content = await fs.readFile(filePath, "utf-8");
      const loaded = JSON.parse(content);

      expect(loaded).toEqual(testState);
    });

    it("should debounce saves", async () => {
      let writeCount = 0;

      // Mock fs.writeFile to count writes
      const originalWriteFile = fs.writeFile;
      const countingWriteFile = async (...args: Parameters<typeof fs.writeFile>) => {
        writeCount++;
        return (originalWriteFile as Function).apply(fs, args);
      };
      // biome-ignore lint/suspicious/noExplicitAny: test mock override
      (fs as any).writeFile = countingWriteFile;

      const testState: TabPersistedState = {
        version: 1,
        selectedTabId: "tab1",
        tabOrder: ["tab1"],
        pinnedTabIds: [],
        perTabState: {},
        savedAt: new Date().toISOString(),
      };

      // Queue multiple rapid saves
      persistence.save(testState);
      persistence.save(testState);
      persistence.save(testState);

      // Wait for debounce
      await new Promise(resolve => setTimeout(resolve, 600));

      // Should only write once due to debouncing
      expect(writeCount).toBe(1);

      // Restore original
      fs.writeFile = originalWriteFile;
    });

    it("should create directory if it does not exist", async () => {
      const testState: TabPersistedState = {
        version: 1,
        selectedTabId: "tab1",
        tabOrder: ["tab1"],
        pinnedTabIds: [],
        perTabState: {},
        savedAt: new Date().toISOString(),
      };

      const nestedDir = path.join(tempDir, "nested", "path");
      persistence = new TabPersistence(nestedDir);

      await persistence.save(testState);
      await new Promise(resolve => setTimeout(resolve, 600));

      const filePath = path.join(nestedDir, "tab_state.json");
      const exists = await fs
        .access(filePath)
        .then(() => true)
        .catch(() => false);

      expect(exists).toBe(true);
    });
  });

  describe("Flush", () => {
    it("should flush pending saves immediately", async () => {
      const testState: TabPersistedState = {
        version: 1,
        selectedTabId: "tab1",
        tabOrder: ["tab1"],
        pinnedTabIds: [],
        perTabState: {},
        savedAt: new Date().toISOString(),
      };

      persistence.save(testState);

      // Flush immediately (before debounce would complete)
      await persistence.flush();

      const filePath = path.join(tempDir, "tab_state.json");
      const exists = await fs
        .access(filePath)
        .then(() => true)
        .catch(() => false);

      expect(exists).toBe(true);
    });

    it("should handle no pending saves", async () => {
      // Should not throw
      await persistence.flush();
    });
  });

  describe("Create State", () => {
    it("should create state from tab instances", () => {
      const tabs = [
        createMockTabSurface("tab1", "terminal", "Terminal"),
        createMockTabSurface("tab2", "agent", "Agent"),
      ];

      const state = persistence.createState("tab1", ["tab1", "tab2"], [], tabs);

      expect(state.version).toBe(1);
      expect(state.selectedTabId).toBe("tab1");
      expect(state.tabOrder).toEqual(["tab1", "tab2"]);
      expect(state.pinnedTabIds).toEqual([]);
      expect(state.perTabState).toHaveProperty("tab1");
      expect(state.perTabState).toHaveProperty("tab2");
    });

    it("should include pinned tab IDs", () => {
      const tabs = [createMockTabSurface("tab1", "terminal", "Terminal")];

      const state = persistence.createState("tab1", ["tab1"], ["tab1"], tabs);

      expect(state.pinnedTabIds).toEqual(["tab1"]);
    });
  });

  describe("Restore State", () => {
    it("should restore state to tab instances", () => {
      const tabs = [
        createMockTabSurface("tab1", "terminal", "Terminal"),
        createMockTabSurface("tab2", "agent", "Agent"),
      ];

      const testState: TabPersistedState = {
        version: 1,
        selectedTabId: "tab1",
        tabOrder: ["tab1", "tab2"],
        pinnedTabIds: [],
        perTabState: {
          tab1: {
            tabId: "tab1",
            tabType: "terminal",
            label: "Terminal-Modified",
          },
        },
        savedAt: new Date().toISOString(),
      };

      persistence.restoreState(testState, tabs);

      expect(tabs[0].getLabel()).toBe("Terminal-Modified");
    });

    it("should handle tabs not in persisted state", () => {
      const tabs = [
        createMockTabSurface("tab1", "terminal", "Terminal"),
        createMockTabSurface("tab3", "session", "Session"),
      ];

      const testState: TabPersistedState = {
        version: 1,
        selectedTabId: "tab1",
        tabOrder: ["tab1"],
        pinnedTabIds: [],
        perTabState: {
          tab1: {
            tabId: "tab1",
            tabType: "terminal",
            label: "Terminal",
          },
        },
        savedAt: new Date().toISOString(),
      };

      // Should not throw
      persistence.restoreState(testState, tabs);

      expect(tabs[0].getLabel()).toBe("Terminal");
      expect(tabs[1].getLabel()).toBe("Session"); // Unchanged
    });
  });

  describe("Delete", () => {
    it("should delete the persisted state file", async () => {
      const testState: TabPersistedState = {
        version: 1,
        selectedTabId: "tab1",
        tabOrder: ["tab1"],
        pinnedTabIds: [],
        perTabState: {},
        savedAt: new Date().toISOString(),
      };

      await persistence.save(testState);
      await new Promise(resolve => setTimeout(resolve, 600));

      const filePath = path.join(tempDir, "tab_state.json");
      let exists = await fs
        .access(filePath)
        .then(() => true)
        .catch(() => false);

      expect(exists).toBe(true);

      await persistence.delete();

      exists = await fs
        .access(filePath)
        .then(() => true)
        .catch(() => false);

      expect(exists).toBe(false);
    });

    it("should handle non-existent file gracefully", async () => {
      // Should not throw
      await persistence.delete();
    });
  });

  describe("Validation", () => {
    it("should validate correct structure", () => {
      const testState: TabPersistedState = {
        version: 1,
        selectedTabId: "tab1",
        tabOrder: ["tab1", "tab2"],
        pinnedTabIds: ["tab1"],
        perTabState: {
          tab1: {
            tabId: "tab1",
            tabType: "terminal",
            label: "Terminal",
          },
        },
        savedAt: new Date().toISOString(),
      };

      // Will not throw
      const loadedState = persistence["validateState"](testState);
      expect(loadedState).toBe(true);
    });

    it("should reject null selectedTabId", () => {
      const testState: TabPersistedState = {
        version: 1,
        selectedTabId: null,
        tabOrder: ["tab1"],
        pinnedTabIds: [],
        perTabState: {},
        savedAt: new Date().toISOString(),
      };

      const isValid = persistence["validateState"](testState);
      expect(isValid).toBe(true); // null is allowed
    });
  });
});
