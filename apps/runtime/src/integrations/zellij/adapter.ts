export interface ZellijAdapter {
  ensureSession(sessionName: string): Promise<void>;
  openPane(sessionName: string, command: string): Promise<void>;
  killSession(sessionName: string): Promise<void>;
}
