export interface A2aAdapter {
  delegateTask(
    targetAgentId: string,
    payload: Record<string, unknown>,
  ): Promise<{ delegationId: string }>;
}
