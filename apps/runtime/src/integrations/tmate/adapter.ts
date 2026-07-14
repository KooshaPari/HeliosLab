export interface TmateAdapter {
  startShare(terminalId: string): Promise<{ sshCommand: string; webUrl?: string }>;
  stopShare(terminalId: string): Promise<void>;
}
