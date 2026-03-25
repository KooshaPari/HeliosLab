# WP03 Task Goals - Update GitHub Actions CI Workflow

## Objective

Update .github/workflows/build-release.yml to use bun and task commands instead of npm.

## Changes Required

### 1. build-release.yml modifications:

- Replace `npm install` or `npm ci` with `bun install`
- Replace `npm version` commands (line ~248) with `bunx npm version`
- Replace `npm publish` commands (line ~253) with `bunx npm publish`
- Add go-task installation step after checkout & bun setup, before build steps
- Keep Node.js setup for npm registry authentication (needed for bunx npm publish)

### 2. Check for other workflow files

- Look for any other .yml files in .github/workflows/
- Update them too if they reference npm

## Notes

- Use bunx npm to access npm commands through Bun
- Keep all npm flags intact when converting commands
- go-task installation command:
  ```yaml
  - name: Install go-task
    run: |
      sh -c "$(curl --location https://taskfile.dev/install.sh)" -- -d -b /usr/local/bin
      task --version
  ```
- Do NOT run commands, only make file edits
