export interface ZmxAdapter {
  checkpoint(sessionId: string): Promise<string>;
  restore(checkpointId: string): Promise<void>;
}
