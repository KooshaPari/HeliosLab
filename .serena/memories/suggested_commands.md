# Suggested Commands for heliosApp Development

## Development

- `bun run dev` or `task dev` - Run development server
- `bun run build:stable` or `task build` - Build stable release
- `bun run build:canary` - Build canary release
- `bun install` or part of `task setup` - Install dependencies

## Testing & Quality

- `bun run test` or `bunx vitest run` - Run test suite
- `task quality:ci` - CI quality gate (non-mutating)
- `task quality:quick` - Quick quality check (readonly)
- `task quality` - Full quality gate (format, lint, test)
- `task quality:fmt` - Format code with Biome
- `task quality:lint` - Lint code with Biome

## After Task Completion

1. Run `task quality:ci` for non-mutating quality checks
2. Or run `task quality` if you need to mutate (format/fix code)
3. Verify tests pass with `bun run test`

## System Commands (macOS)

- Standard Unix: `git`, `ls`, `cd`, `grep`, `find`
- Package management: `bun` (installed in CI via curl)
- Task automation: `task` (requires go-task installation)
