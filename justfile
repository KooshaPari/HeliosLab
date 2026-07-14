set shell := ["bash", "-euo", "pipefail", "-c"]

default:
  task --list

preflight:
  task preflight

deps:
  task deps

typecheck:
  task typecheck

lint:
  task lint

test:
  task test

coverage:
  task coverage

docs-index:
  task docs:index

docs-build:
  task docs:build

quality-quick:
  task quality:quick

quality-strict:
  task quality:strict

check:
  task check

ci:
  task ci

devops-status:
  task devops:status

devops-check:
  task devops:check

devops-check-ci:
  task devops:check:ci

devops-check-ci-summary:
  task devops:check:ci-summary

devops-push *ARGS:
  bash scripts/push-heliosapp-with-fallback.sh {{ARGS}}

devops-push-origin *ARGS:
  bash scripts/push-heliosapp-with-fallback.sh --skip-primary {{ARGS}}

devops-checker *ARGS:
  bash scripts/devops-checker.sh {{ARGS}}
