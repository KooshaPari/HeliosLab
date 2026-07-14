const MIN_RETENTION_DAYS = 30;

export type RetentionPolicyConfig = {
  retention_days: number;
  exempt_topics: string[];
  redacted_fields: string[];
};

export function createRetentionPolicyConfig(
  input: Partial<RetentionPolicyConfig> = {}
): RetentionPolicyConfig {
  const retentionDays = input.retention_days ?? MIN_RETENTION_DAYS;
  if (!Number.isInteger(retentionDays) || retentionDays < MIN_RETENTION_DAYS) {
    throw new Error(`retention_days must be an integer >= ${MIN_RETENTION_DAYS}`);
  }

  return {
    retention_days: retentionDays,
    exempt_topics: [...(input.exempt_topics ?? ["audit.retention.deleted"])],
    redacted_fields: [...(input.redacted_fields ?? defaultRedactedFields())],
  };
}

export function defaultRedactedFields(): string[] {
  return [
    "authorization",
    "token",
    "api_key",
    "secret",
    "password",
    "access_token",
    "refresh_token",
  ];
}
