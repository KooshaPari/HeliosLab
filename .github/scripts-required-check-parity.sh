#!/usr/bin/env bash
set -euo pipefail

manifest=".github/required-checks.txt"
self_merge_workflow=".github/workflows/self-merge-gate.yml"

if [[ ! -f "$manifest" ]]; then
  echo "Missing manifest: $manifest"
  exit 1
fi
if [[ ! -f "$self_merge_workflow" ]]; then
  echo "Missing workflow: $self_merge_workflow"
  exit 1
fi

manifest_ids=()
while IFS='|' read -r workflow_file job_name check_id; do
  [[ -z "${workflow_file}" ]] && continue
  [[ "${workflow_file}" =~ ^# ]] && continue

  normalized_id="${check_id:-}"
  if [[ -z "$normalized_id" ]]; then
    normalized_id="${job_name}"
  fi
  manifest_ids+=("$normalized_id")
done < "$manifest"

if [[ ${#manifest_ids[@]} -eq 0 ]]; then
  echo "Manifest has no check entries: $manifest"
  exit 1
fi

map_ids=()
while IFS= read -r line; do
  map_id="$(printf '%s' "$line" | sed -E "s/.*:[[:space:]]*'([^']+)'.*/\1/")"
  [[ -n "$map_id" ]] && map_ids+=("$map_id")
done < <(grep -E "^[[:space:]]*'[^']+':[[:space:]]*'[^']+'" "$self_merge_workflow")

missing=0
for required_id in "${map_ids[@]}"; do
  if ! printf '%s\n' "${manifest_ids[@]}" | grep -Fxq "$required_id"; then
    echo "Missing required-check id '$required_id' in $manifest"
    missing=1
  fi
done

if [[ "$missing" -ne 0 ]]; then
  echo "Required-check parity failed."
  exit 1
fi

echo "Required-check parity passed."
