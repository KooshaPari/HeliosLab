# Implementation Strategy

Use one root `Taskfile.yml` with simple shell conditionals:

- Prefer Python commands when `pyproject.toml` is present
- Keep the clean step limited to generated artifacts
- Remove egg-info directories recursively because Python build backends may create
  package metadata outside the repository root
