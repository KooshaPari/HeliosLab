# Journey: Setting Up heliosApp Development

**Journey ID:** JOURNEY-001  
**Project:** heliosApp  
**Tier:** DEEP  
**Last Updated:** 2026-04-04

---

## Overview

This journey guides new contributors through setting up a complete heliosApp development environment. By the end, you will have a running instance with working terminal multiplexing, AI inference, and collaborative session management.

**Prerequisites:**
- macOS 14+ or Linux (Ubuntu 22.04+)
- Bun 1.2.20+ installed
- 16GB RAM minimum (32GB recommended)
- Git configured with SSH keys

**Estimated Time:** 45-60 minutes

---

## Step 1: Clone the Repository

Start by cloning the heliosApp repository:

```bash
git clone git@github.com:KooshaPari/heliosApp.git
cd heliosApp
```

**What happens:** The monorepo structure is cloned, including all apps and packages.

```
heliosApp/
├── apps/
│   ├── runtime/        # Core runtime engine
│   ├── desktop/        # Desktop shell (ElectroBun)
│   ├── renderer/       # SolidJS web renderer
│   └── colab-renderer/ # Collaborative renderer
├── packages/
│   ├── runtime-core/  # Shared types and API client
│   ├── ids/           # ULID-based ID generation
│   ├── errors/        # Error type definitions
│   ├── logger/        # Pino-based logging
│   └── types/         # Base TypeScript types
└── docs/              # VitePress documentation
```

---

## Step 2: Install Dependencies

Install all dependencies using Bun:

```bash
bun install --frozen-lockfile
```

**What happens:**
- Bun resolves all workspace dependencies
- Links internal packages (runtime-core, ids, etc.)
- Installs native add-ons for PTY management

**Verification:** Run `bun run typecheck` to verify TypeScript compilation:

```bash
bun run typecheck
```

Expected output:
```
✓ apps/runtime (OK)
✓ apps/desktop (OK)
✓ apps/renderer (OK)
✓ packages/runtime-core (OK)
```

---

## Step 3: Configure Environment

Copy the environment template:

```bash
cp .env.example .env
```

Edit `.env` with your credentials:

```bash
# Required: Anthropic API key for Claude inference
ANTHROPIC_API_KEY=sk-ant-xxxxx

# Optional: GitHub token for repository access
GITHUB_TOKEN=ghp_xxxxx
```

**Security Note:** Never commit `.env` to version control. It's in `.gitignore`.

---

## Step 4: Understand the Architecture

Before running, understand heliosApp's event-driven architecture:

```
┌─────────────────────────────────────────────────────────────────┐
│                      Desktop Shell (ElectroBun)                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Tab management, panels, context store                    │   │
│  └──────────────────────────┬───────────────────────────────┘   │
│                             │ LocalBus V1 (26 methods, 40 topics)
┌─────────────────────────────┼───────────────────────────────────┐
│                             ▼
│  ┌─────────────────────────────────────────────────────────────┐
│  │                     Runtime Engine (Bun)                    │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐       │
│  │  │ Sessions │ │   PTY    │ │ Providers│ │ Recovery │       │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘       │
│  └────────────────────────────┬──────────────────────────────┘
│                               │ HTTP API
┌───────────────────────────────▼────────────────────────────────┐
│                      Web Renderer (SolidJS)                     │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────┐ │
│  │ Terminal Panel   │  │ Chat Panel       │  │ Sidebar      │ │
│  └──────────────────┘  └──────────────────┘  └──────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

**Key Concepts:**
- **LocalBus:** In-process message bus with typed envelopes
- **Lanes:** Isolated execution contexts bound to git worktrees
- **Sessions:** User/agent connections to lanes
- **PTY:** Pseudo-terminal for shell process management

---

## Step 5: Run Development Mode

Start the development environment:

```bash
bun run dev
```

**What happens:**
1. Runtime engine starts on port 2935
2. Desktop shell launches (ElectroBun window)
3. Web renderer connects via HTTP
4. LocalBus begins accepting method calls

**Expected Output:**
```
[Runtime] LocalBus initialized with 26 methods, 40 topics
[Runtime] Provider "anthropic" registered
[Runtime] Listening on http://localhost:2935
[Desktop] Connecting to runtime...
[Desktop] Connected. Session active.
```

---

## Step 6: Create Your First Workspace

In the desktop shell UI:

1. Click **+ New Workspace**
2. Enter workspace name: `helios-dev`
3. Select project type: `Git Clone` or `Local Directory`
4. Click **Create**

**What happens:**
- Workspace record created in `~/.helios/workspaces/`
- Default lane `main` created
- Terminal PTY spawned

**Verification:** Check workspace file:

```bash
cat ~/.helios/workspaces/helios-dev/workspace.json
```

---

## Step 7: Open the Web Renderer

Navigate to the web renderer:

```
http://localhost:2935/renderer
```

**Components:**
- **Terminal Panel:** xterm.js rendering of PTY output
- **Chat Panel:** AI conversation interface with streaming
- **Sidebar:** Lane navigation, session management

---

## Step 8: Verify LocalBus Communication

Open browser DevTools (F12) and run:

```javascript
// Test LocalBus via runtime client
const response = await fetch('http://localhost:2935/v1/protocol/dispatch', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    envelope: {
      id: 'env_test',
      correlation_id: 'cor_test',
      type: 'command',
      method: 'workspace.list',
      payload: {},
      context: {},
      timestamp: Date.now()
    }
  })
});

console.log(await response.json());
```

**Expected Response:**
```json
{
  "success": true,
  "data": {
    "workspaces": [{ "id": "ws_...", "name": "helios-dev" }]
  }
}
```

---

## Step 9: Run Quality Gates

Before making changes, verify the full test suite:

```bash
bun run gates
```

**Gates executed:**
1. `typecheck` - TypeScript compilation
2. `lint` - Biome/oxlint code quality
3. `test` - Unit tests with coverage
4. `test:e2e` - Playwright end-to-end tests
5. `gate-security` - Dependency vulnerability scan

**Pass threshold:** All gates must pass (100% coverage on critical paths)

---

## Step 10: Next Steps

Now that your environment is set up:

### Explore the Codebase

```bash
# View runtime LocalBus implementation
ls apps/runtime/src/protocol/

# View SolidJS renderer components
ls apps/renderer/src/components/

# View state machine definitions
ls apps/runtime/src/*/machine.ts
```

### Read Key Documentation

- **SPEC.md:** Complete technical specification
- **SOTA-001.md:** State of the art research
- **ADR-HELIOS-001/002/003:** Architecture decisions

### Join the Community

- GitHub Issues: Report bugs and request features
- Discord: Real-time discussion with the team
- Wiki: Community-contributed guides

---

## Troubleshooting

### Port Already in Use

If port 2935 is occupied:

```bash
# Find the process
lsof -i :2935

# Kill it
kill -9 <PID>
```

### Bun Version Mismatch

```bash
# Check installed version
bun --version

# Update if < 1.2.20
curl -fsSL https://bun.sh/install | bash
```

### TypeScript Errors

```bash
# Clear cache and retry
rm -rf node_modules/.cache
bun run typecheck
```

---

## Summary

You now have a complete heliosApp development environment:

| Component | Status | Location |
|-----------|--------|----------|
| Runtime Engine | Running | http://localhost:2935 |
| Desktop Shell | Running | ElectroBun window |
| Web Renderer | Running | http://localhost:2935/renderer |
| Workspace | Created | ~/.helios/workspaces/helios-dev |
| LocalBus | Active | 26 methods, 40 topics |

**Next Journey:** [Adding a New Feature Component](./adding-a-new-feature-component.md)

---

*Document Version: 1.0*  
*Maintainer: Phenotype Engineering*
