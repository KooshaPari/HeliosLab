export interface AcpClientAdapter {
  runTask(sessionId: string, prompt: string): Promise<{ taskId: string }>;
  cancelTask(taskId: string): Promise<void>;
}
