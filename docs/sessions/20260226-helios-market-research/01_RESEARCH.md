# Research

## 1. Problem and Opportunity

Developers running deep terminal workflows currently split across:
- terminal emulator
- multiplexer
- AI coding CLI
- chat surfaces
- project/task tooling

The fragmentation tax is now mostly in context switching, trust/safety checks, and workflow replayability.

HeliosApp opportunity: combine terminal-native speed with IDE-grade orchestration and policy controls while keeping runtime lightweight.

## 2. Competitive Landscape

### OpenAI Codex
- Codex CLI publicly positioned as terminal-first coding workflow with agentic capabilities.
- Strategic signal: users expect local CLI ergonomics, scripted usage, and approval controls.
- Implication: HeliosApp should treat Codex as a provider adapter, not a monolith.

Source:
- https://github.com/openai/codex
- https://developers.openai.com/

### Claude Code ecosystem
- Claude Code docs position terminal-native agent workflows with tooling integrations.
- Wrapper apps (CodePilot/opcode/yume/crystal-family) are differentiating mostly on UX, session management, and multi-agent orchestration.

Source:
- https://code.claude.com/docs/en/overview

### OSS wrapper apps studied

#### CodePilot (`op7418/CodePilot`)
- Stack: Electron + Next.js + SQLite.
- Features: chat/project/session management, MCP transport support, settings and skills workflow.
- Tradeoff: rich UI but heavier memory/runtime profile expected from Electron + local web server architecture.

Source:
- https://github.com/op7418/CodePilot

#### opcode (`winfunc/opcode`)
- Stack: Tauri + Rust + React + SQLite.
- Features: session timeline, checkpoints/forking, MCP management, local-first/no telemetry posture.
- Tradeoff: stronger efficiency and native process model than Electron; still must manage multi-process orchestration complexity.

Source:
- https://github.com/winfunc/opcode

#### yume (`aofp/yume`)
- Stack: Tauri + React + local orchestration server.
- Positioning: terminal-free UX over Claude Code-compatible behavior, multi-provider abstraction, high tab/window claims.
- Tradeoff: aggressive scope introduces risk in protocol drift and reliability under heavy concurrency.

Source:
- https://github.com/aofp/yume

#### crystal (`stravu/crystal`)
- OSS desktop UI in Claude-wrapper category.
- Signal: sustained demand for richer interaction model around CLI-native agents.

Source:
- https://github.com/stravu/crystal

#### Claude Squad (community offering)
- Positioning in ecosystem as multi-agent/coordination-oriented UX around Claude workflows.
- Signal: users want orchestration patterns (parallel tasks, role specialization), not only single-thread chats.

Source:
- Public listings and repository references vary; verify exact canonical repo before implementation dependencies.

### Broader terminal-agent competitors
- Gemini CLI
- Copilot CLI
- Aider
- OpenHands CLI

Signal: terminal agent category is real; differentiation shifts to reliability, safety policy, and long-running workflow ergonomics.

Sources:
- https://github.com/google-gemini/gemini-cli
- https://github.blog/changelog/2026-02-25-github-copilot-cli-is-now-generally-available/
- https://github.com/Aider-AI/aider
- https://openhands.dev/product/cli

### Agent orchestration map
- Awesome Agent Orchestrators list is useful for pattern discovery and ecosystem scanning, not as direct architecture authority.

Source:
- https://github.com/andyrewlee/awesome-agent-orchestrators

### Google Antigravity
- Used here as a market-signal reference for next-gen coding UX experiments.
- Product details should be treated as directional until stable official technical documentation is published.

## 3. User and Market Insights

### Core personas
- Terminal-Primary Backend Engineer
- Platform/SRE Operator
- Security-Conscious Team Lead
- Solo Founder/Staff Engineer in high-throughput repo environments

### Top pains
- Context fragmentation across terminal + AI + project tooling
- Unclear trust boundary for command execution
- Weak rollback/audit semantics
- Poor handling of many concurrent terminals/projects

### Jobs to be done
- Execute feature/fix from prompt to patch without leaving terminal workflow
- Safely automate repetitive repo operations with approvals
- Preserve reproducible session history per project
- Run many live terminals with minimal lag

## 4. Product Gap Identified

Current tools usually optimize one dimension:
- UX polish (Electron wrappers)
- low footprint (native wrappers)
- pure terminal speed (CLI tools)

HeliosApp gap to own:
- native responsiveness + multi-terminal scale + policy-grade execution control + provider-agnostic orchestration.

## 5. Research Implications for HeliosApp

- Do not build an Electron-first architecture if memory target is strict (<500 MB practical working set).
- Build around native process supervision, PTY/mux performance, and deterministic command governance.
- Treat AI providers as pluggable runtimes behind a normalized session/execution contract.
