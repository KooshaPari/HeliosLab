import {
  CheckpointWriter,
  CheckpointReader,
  type Checkpoint,
  type CheckpointSession,
  estimateCheckpointSize,
} from "../checkpoint.js";
import { promises as fs } from "fs";
import path from "path";
import os from "os";

// Traces to: FR-CRH-003 (zmx checkpoint for restoration), FR-CRH-004 (checkpoint integrity validation)
describe("CheckpointWriter and CheckpointReader", () => {
  let writer: CheckpointWriter;
  let reader: CheckpointReader;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = path.join(os.tmpdir(), `checkpoint-test-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });
    writer = new CheckpointWriter(tempDir);
    reader = new CheckpointReader(tempDir);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  describe("atomic write", () => {
    it("should write checkpoint with valid checksum", async () => {
      const session: CheckpointSession = {
        sessionId: "sess-1",
        terminalId: "term-1",
        laneId: "lane-1",
        workingDirectory: "/home/user",
        environmentVariables: { HOME: "/home/user" },
        scrollbackSnapshot: "test output",
        zelijjSessionName: "main",
        shellCommand: "bash",
      };

      const checkpoint: Checkpoint = {
        version: 1,
        timestamp: Date.now(),
        checksum: "", // Will be calculated
        sessions: [session],
      };

      await writer.write(checkpoint);

      const checkpointPath = writer.getCheckpointPath();
      const exists = await fs
        .access(checkpointPath)
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(true);

      const content = await fs.readFile(checkpointPath, "utf-8");
      const written = JSON.parse(content) as Checkpoint;
      expect(written.sessions[0].sessionId).toBe("sess-1");
      expect(written.checksum).toBeTruthy();
    });

    it("should use atomic write pattern (temp + rename)", async () => {
      const session: CheckpointSession = {
        sessionId: "sess-1",
        terminalId: "term-1",
        laneId: "lane-1",
        workingDirectory: "/home/user",
        environmentVariables: {},
        scrollbackSnapshot: "test",
        zelijjSessionName: "main",
        shellCommand: "bash",
      };

      const checkpoint: Checkpoint = {
        version: 1,
        timestamp: Date.now(),
        checksum: "",
        sessions: [session],
      };

      await writer.write(checkpoint);

      // Temp file should not exist after write
      const tempPath = `${writer.getCheckpointPath()}.tmp`;
      const tempExists = await fs
        .access(tempPath)
        .then(() => true)
        .catch(() => false);
      expect(tempExists).toBe(false);

      // Final file should exist
      const checkpointPath = writer.getCheckpointPath();
      const exists = await fs
        .access(checkpointPath)
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(true);
    });

    it("should backup previous checkpoint", async () => {
      const session1: CheckpointSession = {
        sessionId: "sess-1",
        terminalId: "term-1",
        laneId: "lane-1",
        workingDirectory: "/home/user",
        environmentVariables: {},
        scrollbackSnapshot: "test1",
        zelijjSessionName: "main",
        shellCommand: "bash",
      };

      const session2: CheckpointSession = {
        ...session1,
        scrollbackSnapshot: "test2",
      };

      await writer.write({
        version: 1,
        timestamp: Date.now(),
        checksum: "",
        sessions: [session1],
      });

      await writer.write({
        version: 1,
        timestamp: Date.now(),
        checksum: "",
        sessions: [session2],
      });

      const backupPath = `${writer.getCheckpointPath()}.backup`;
      const backupExists = await fs
        .access(backupPath)
        .then(() => true)
        .catch(() => false);
      expect(backupExists).toBe(true);

      const backupContent = await fs.readFile(backupPath, "utf-8");
      const backup = JSON.parse(backupContent) as Checkpoint;
      expect(backup.sessions[0].scrollbackSnapshot).toBe("test1");
    });
  });

  describe("read", () => {
    it("should read valid checkpoint", async () => {
      const session: CheckpointSession = {
        sessionId: "sess-1",
        terminalId: "term-1",
        laneId: "lane-1",
        workingDirectory: "/home/user",
        environmentVariables: { HOME: "/home/user" },
        scrollbackSnapshot: "test output",
        zelijjSessionName: "main",
        shellCommand: "bash",
      };

      const checkpoint: Checkpoint = {
        version: 1,
        timestamp: Date.now(),
        checksum: "",
        sessions: [session],
      };

      await writer.write(checkpoint);
      const read = await reader.read();

      expect(read).not.toBeNull();
      expect(read?.sessions[0].sessionId).toBe("sess-1");
    });

    it("should return null when checkpoint does not exist", async () => {
      const read = await reader.read();
      expect(read).toBeNull();
    });

    it("should return null on corrupted checksum", async () => {
      const session: CheckpointSession = {
        sessionId: "sess-1",
        terminalId: "term-1",
        laneId: "lane-1",
        workingDirectory: "/home/user",
        environmentVariables: {},
        scrollbackSnapshot: "test",
        zelijjSessionName: "main",
        shellCommand: "bash",
      };

      const checkpoint: Checkpoint = {
        version: 1,
        timestamp: Date.now(),
        checksum: "",
        sessions: [session],
      };

      await writer.write(checkpoint);

      // Corrupt the file
      const checkpointPath = writer.getCheckpointPath();
      let content = await fs.readFile(checkpointPath, "utf-8");
      let parsed = JSON.parse(content) as Checkpoint;
      parsed.checksum = "invalid-checksum";
      await fs.writeFile(checkpointPath, JSON.stringify(parsed));

      const read = await reader.read();
      expect(read).toBeNull();
    });

    it("should try backup checkpoint if primary is corrupted", async () => {
      const session: CheckpointSession = {
        sessionId: "sess-1",
        terminalId: "term-1",
        laneId: "lane-1",
        workingDirectory: "/home/user",
        environmentVariables: {},
        scrollbackSnapshot: "test",
        zelijjSessionName: "main",
        shellCommand: "bash",
      };

      // Write first checkpoint (will become backup)
      await writer.write({
        version: 1,
        timestamp: Date.now(),
        checksum: "",
        sessions: [session],
      });

      // Write second checkpoint
      const session2 = { ...session, scrollbackSnapshot: "test2" };
      await writer.write({
        version: 1,
        timestamp: Date.now(),
        checksum: "",
        sessions: [session2],
      });

      // Corrupt primary
      const checkpointPath = writer.getCheckpointPath();
      let content = await fs.readFile(checkpointPath, "utf-8");
      let parsed = JSON.parse(content) as Checkpoint;
      parsed.checksum = "invalid";
      await fs.writeFile(checkpointPath, JSON.stringify(parsed));

      // Should read from backup
      const read = await reader.read();
      expect(read).not.toBeNull();
      expect(read?.sessions[0].scrollbackSnapshot).toBe("test");
    });
  });

  describe("size estimation", () => {
    it("should estimate checkpoint size", () => {
      const size = estimateCheckpointSize(25);
      expect(size).toBeGreaterThan(0);
      // For 25 sessions, rough estimate is 1024 + 25 * (500 + 10240) = ~270KB
      expect(size).toBeLessThan(1 * 1024 * 1024); // Less than 1MB
    });

    it("should scale with session count", () => {
      const size1 = estimateCheckpointSize(1);
      const size25 = estimateCheckpointSize(25);
      expect(size25).toBeGreaterThan(size1);
    });
  });

  describe("stale temp file cleanup", () => {
    it("should clean stale temp files on next write", async () => {
      const checkpointPath = writer.getCheckpointPath();
      const tempPath = `${checkpointPath}.tmp`;

      // Create stale temp file
      await fs.mkdir(path.dirname(tempPath), { recursive: true });
      await fs.writeFile(tempPath, "stale");

      const session: CheckpointSession = {
        sessionId: "sess-1",
        terminalId: "term-1",
        laneId: "lane-1",
        workingDirectory: "/home/user",
        environmentVariables: {},
        scrollbackSnapshot: "test",
        zelijjSessionName: "main",
        shellCommand: "bash",
      };

      await writer.write({
        version: 1,
        timestamp: Date.now(),
        checksum: "",
        sessions: [session],
      });

      // Stale temp file should be cleaned
      const stillExists = await fs
        .access(tempPath)
        .then(() => true)
        .catch(() => false);
      expect(stillExists).toBe(false);
    });
  });
});
