export interface UptermAdapter {
  startShare(terminalId: string): Promise<{ shareUrl: string }>;
  stopShare(terminalId: string): Promise<void>;
}
