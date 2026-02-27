export interface McpAdapter {
  callTool(serverId: string, toolName: string, args: Record<string, unknown>): Promise<unknown>;
}
