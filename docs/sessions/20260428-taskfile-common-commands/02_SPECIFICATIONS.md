# Specifications

## Task mapping

- `build`: build the Python package
- `test`: run the primary test suite
- `lint`: run static analysis for the primary stack
- `clean`: remove generated artifacts and caches

## Constraints

- Do not touch runtime source behavior.
- Keep the task definitions shell-driven and aligned with the Python package metadata.
