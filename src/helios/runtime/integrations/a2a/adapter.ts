export interface A2aAdapter {
  delegateTask(
    targetAgentId: string,
    payload: Readonly<Record<string, unknown>>,
  ): Promise<{ delegationId: string }>;
}
