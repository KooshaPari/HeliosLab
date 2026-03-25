#!/usr/bin/env bash
set -euo pipefail

required_paths=(
  "docs/changes/shared-modules/polyglot-config-core-v1/proposal.md"
  "docs/changes/shared-modules/polyglot-config-core-v1/tasks.md"
  "docs/guides/polyglot-config-core-module.md"
  "contracts/polyglot-config-core.contract.json"
  "scripts/validate_polyglot_contract.sh"
)

missing=0
for path in "${required_paths[@]}"; do
  if [[ -e "${path}" ]]; then
    echo "OK: ${path}"
  else
    echo "MISSING: ${path}"
    missing=1
  fi
done

if [[ "${missing}" -ne 0 ]]; then
  echo "Polyglot contract validation failed."
  exit 1
fi

echo "Polyglot contract validation passed."
