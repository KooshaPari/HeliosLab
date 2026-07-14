# Branch Protection Configuration for main

## Overview

This document defines the branch protection rules for the `main` branch. These rules enforce merge requirements at the GitHub level to prevent unreviewed or non-compliant code from entering the production codebase.

## Branch Protection Rules

### Required Status Checks

The following status checks must pass before a pull request can be merged:

1. **quality-gates** - Quality gates from spec 021 (linting, formatting, type checking)
2. **gca-review** - GitHub Code Analysis automated review
3. **coderabbit-review** - CodeRabbit automated code review
4. **compliance-check** - Compliance checker from WP02

All status checks must pass before merge is allowed.

### Required Pull Request Reviews

- **Minimum reviews required**: 1 approval
- **Dismiss stale pull request approvals**: Enabled (new pushes reset review status)
- **Require review from code owners**: Enabled if CODEOWNERS file exists
- **Require status checks to pass before merge**: Enabled

### Merge Restrictions

- **Require linear history**: Enabled (no merge commits allowed; only rebase and fast-forward)
- **Restrict who can push to matching branches**: Enabled (only allow PR merges, no direct pushes)
- **Allow bypassing the above settings**: Disabled (no bypass possible)
- **Require branches to be up to date**: Enabled (rebase before merge)

### Protection Scope

- **Branch pattern**: `main`
- **Applies to**: All users, including administrators
- **Enforced**: Yes

## Rate-Limiting Handling

Both GCA and CodeRabbit may be rate-limited. The following behavior applies:

- **Initial status**: Pending (blocking merge)
- **Retry strategy**: Exponential backoff (1m, 2m, 4m, 8m, max 15m)
- **Failure notification**: Author is notified via PR comment
- **Merge behavior**: Merge remains blocked until rate limit is resolved or tool returns a result

## Implementation via GitHub API

To apply these settings programmatically via the GitHub API:

```bash
curl -X PUT \
  -H "Accept: application/vnd.github+json" \
  -H "Authorization: token YOUR_TOKEN" \
  https://api.github.com/repos/OWNER/REPO/branches/main/protection \
  -d '{
    "required_status_checks": {
      "strict": true,
      "contexts": ["quality-gates", "gca-review", "coderabbit-review", "compliance-check"]
    },
    "required_pull_request_reviews": {
      "dismissal_restrictions": {},
      "dismiss_stale_reviews": true,
      "require_code_owner_reviews": true,
      "required_approving_review_count": 1
    },
    "enforce_admins": true,
    "required_linear_history": true,
    "allow_force_pushes": false,
    "allow_deletions": false,
    "restrictions": null
  }'
```

## Manual Configuration via GitHub UI

1. Navigate to Repository Settings → Branches
2. Under "Branch protection rules", click "Add rule"
3. Set Branch name pattern: `main`
4. Enable:
   - Require a pull request before merging
   - Require status checks to pass before merging
   - Add required checks: quality-gates, gca-review, coderabbit-review, compliance-check
   - Require branches to be up to date before merging
   - Require linear history
   - Restrict who can push to matching branches
5. Click "Create" to save

## Validation Checklist

- [ ] Branch protection rule exists for `main`
- [ ] All four status checks are required
- [ ] At least one approval required
- [ ] Stale review dismissal enabled
- [ ] Linear history enforced
- [ ] Direct pushes to `main` blocked
- [ ] Rule applies to all users including administrators

## Maintenance

- Review this configuration quarterly
- Update status check names if spec changes
- Add new required checks as governance requirements evolve

