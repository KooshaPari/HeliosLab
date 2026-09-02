# Architecture Decision Record (ADR) Template

## Overview

This is a template for documenting exceptions to the Constitution of Code. Use this template when you need to violate a constitution rule (e.g., create a file > 500 lines, skip tests for a specific module, etc.) with explicit approval and time-bound justification.

## Required Fields

### Title

Short, descriptive title for the exception (e.g., "Large File Exception: Data Migration Utility")

### Status

One of: `proposed`, `accepted`, `superseded`

- **proposed**: Initial submission, awaiting approval
- **accepted**: Approved with 3+ approvals, in effect
- **superseded**: Replaced by a newer ADR

### Date

ISO 8601 date when the ADR was created (YYYY-MM-DD)

### Constitution Section Being Excepted

Which constitution rule does this violate?  
Example: "Code Structure and Maintainability - File size limit (>500 lines)"

### Justification

Why is this exception necessary? Be specific and measurable.

Example:
```
The data migration utility requires 750 lines to handle 45 different legacy 
database schemas. Splitting into multiple files would obscure the mapping 
logic and increase maintenance burden. This exception is preferable to 
creating a fragmented, hard-to-follow implementation.
```

### Sunset Date (or Permanence Justification)

**Choose one:**

#### Option A: Sunset Date

Set a date (ISO 8601) when this exception expires and must be removed or re-approved.

```
Sunset Date: 2026-12-31

After this date, the 750-line utility must be refactored into smaller modules 
or the exception must be re-approved with updated justification.
```

#### Option B: Permanence Justification

If the exception should be permanent, explain why removal is impossible or undesirable.

```
Permanence Justification: 

This file is auto-generated from the legacy schema definition. The 750-line 
size is a direct artifact of the schema complexity. Splitting the file would 
require custom generation logic, which increases complexity without benefit. 
The exception is permanent as long as we support legacy schema migrations.
```

### Required Approvers

This ADR must be approved by at least **3 people**. They can be any combination of:
- Technical leads
- Architecture reviewers
- Product owners
- Senior engineers

Approvals are recorded as comments on the PR that introduces or references this ADR.

Example approval comment:
```
@author I approve this ADR on behalf of the architecture team.
```

## Example ADR

```markdown
# ADR-2026-001: Large File Exception for Data Migration Utility

## Status
accepted

## Date
2026-03-01

## Constitution Section Being Excepted
Code Structure and Maintainability - File size limit (>500 lines)

## Justification
The data migration utility requires 750 lines to handle 45 different legacy 
database schemas. Splitting into multiple files would obscure the mapping 
logic and increase maintenance burden. This exception is preferable to 
creating a fragmented, hard-to-follow implementation.

## Sunset Date
2026-12-31

After this date, the utility must be refactored or the exception re-approved.

## Approvals
- @alice (Architecture Lead) - 2026-03-01
- @bob (Senior Engineer) - 2026-03-01
- @carol (Tech Lead) - 2026-03-01
```

## Usage in PRs

When creating a PR that violates a constitution rule:

1. Create or update an ADR file in `/docs/adrs/` (name: `ADR-YYYY-NNN.md`)
2. Link the ADR in your PR description: "Approval based on ADR-2026-001"
3. Request approvals from 3+ reviewers
4. Have each reviewer confirm approval in a comment
5. The compliance checker will validate the ADR and allow the exception if all requirements are met

## ADR File Naming

Use format: `ADR-YYYY-NNN.md`

- `YYYY`: Year created
- `NNN`: Sequential number (001, 002, etc.)

Example: `ADR-2026-001.md`, `ADR-2026-002.md`

## Governance Log Integration

When a PR with an approved ADR is merged, the ADR reference is recorded in the governance log under `exceptionADRs` field.

## Expiry Tracking

A CI check scans all ADRs for sunset dates and alerts maintainers of upcoming expirations.
