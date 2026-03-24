export interface McpAdapter {
  callTool(
    serverId: string,
    toolName: string,
    args: Readonly<Record<string, unknown>>,
  ): Promise<unknown>;
}
