import { cpus, totalmem } from "node:os";

export interface HardwareCapabilities {
  platform: string;
  arch: string;
  hasAppleSilicon: boolean;
  hasNvidiaGpu: boolean;
  gpuName?: string;
  gpuMemoryMB?: number;
  cpuCores: number;
  ramMB: number;
}

let cached: HardwareCapabilities | null = null;

export async function detectHardware(): Promise<HardwareCapabilities> {
  if (cached) return cached;

  const platform = process.platform;
  const arch = process.arch;
  const hasAppleSilicon = platform === "darwin" && arch === "arm64";

  let hasNvidiaGpu = false;
  let gpuName: string | undefined;
  let gpuMemoryMB: number | undefined;

  try {
    const proc = Bun.spawn(
      ["nvidia-smi", "--query-gpu=name,memory.total", "--format=csv,noheader,nounits"],
      {
        stdout: "pipe",
        stderr: "pipe",
      }
    );
    const output = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;
    if (exitCode === 0 && output.trim()) {
      const [name, memStr] = output.trim().split(", ");
      hasNvidiaGpu = true;
      gpuName = name;
      gpuMemoryMB = Number.parseInt(memStr, 10);
    }
  } catch {
    // nvidia-smi not available
  }

  cached = {
    platform,
    arch,
    hasAppleSilicon,
    hasNvidiaGpu,
    gpuName,
    gpuMemoryMB,
    cpuCores: cpus().length,
    ramMB: Math.round(totalmem() / (1024 * 1024)),
  };
  return cached;
}
