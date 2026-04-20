# Codex Project Adapter

Treat [`/AGENTS.md`](/Users/sly/Workspace/Personal/recall-electron/AGENTS.md) as the primary repository contract.

Codex-specific reminders:

- prefer the smallest suitable project agent under `.codex/agents/`
- use `pnpm` for every command
- keep main, preload, renderer, and packaging ownership explicit in task framing
- reach for the security specialist before widening any preload or IPC surface
- route Electron desktop automation through the Playwright-focused tester agents
