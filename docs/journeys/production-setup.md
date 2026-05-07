# Production Setup

## Objective

Prepare a HeliosLab-backed service for production deployment with explicit configuration,
secret, and version-management checks.

## Workflow

1. Provide production configuration through the supported config source.
2. Configure the secret provider before application startup.
3. Validate feature flags for the deployment environment.
4. Record build and crate version metadata for release traceability.

## Preflight

```bash
phenoctl --help
```

## Acceptance

- Required configuration keys are present before deploy.
- Secrets are supplied by the configured provider and are not committed to the repo.
- Release metadata is available for support and rollback decisions.
