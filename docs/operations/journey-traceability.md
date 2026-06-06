# Journey Traceability

- **Status:** Active
- **Repo:** KooshaPari/HeliosLab
- **Owner:** phenotype-org
- **Date:** 2026-05-02

## Overview

This repo implements the Phenotype journey traceability standard. User-facing flows
carry evidence bundles (keyframes, recordings, manifests) for auditability and handoff.

## Implementation

HeliosLab tracks its journeys in `docs/journeys/manifests/`.

### Journey Manifest Format

Each journey has a manifest JSON:

```json
{
  "id": "helioslab-<journey-name>",
  "repo": "KooshaPari/HeliosLab",
  "flow": "<flow-name>",
  "owner": "phenotype-org",
  "captured": "YYYY-MM-DD",
  "environment": "<env-used>",
  "keyframes": [
    {
      "src": "/cli-journeys/keyframes/<journey>/frame-###.png",
      "caption": "<caption>"
    }
  ],
  "tape": "<tape-id>",
  "related": []
}
```

## Verification

Run the journey gate in CI:

```bash
ls docs/journeys/manifests/*.json | while read f; do jq empty "$f" 2>/dev/null || echo "INVALID: $f"; done
```

## Progress

- [ ] Identify top user-visible flows
- [ ] Add journey manifest per flow
- [ ] Capture keyframes for important states
- [ ] Record and register tape ids
- [ ] Link from README or docs index

## Related

- [Phenotype journey-traceability standard](https://github.com/kooshapari/phenotype-infra/blob/main/docs/governance/journey-traceability-standard.md)
- `docs/operations/iconography/` — icon evidence
