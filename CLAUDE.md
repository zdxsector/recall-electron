# Recall Electron AI Guide

This repository ships project-specific AI guidance for both Claude Code and Codex.

Start here:

1. `AGENTS.md`
2. `.agents/README.md`
3. `.agents/project-contract.md`
4. `.agents/architecture/electron-architecture.md`
5. the relevant agent in `.claude/agents/` or `.codex/agents/`
6. the relevant workflow skill under `.agents/skills/`

Core rules:

- use `pnpm` for every dependency, script, build, and packaging command
- treat `desktop/app.js` as the main-process boundary
- treat `desktop/preload.js` as the privileged bridge boundary
- keep renderer work inside `lib/`
- prefer local bundled assets and packaged HTML over new remote surfaces
- preserve `contextIsolation: true` and `nodeIntegration: false`
- validate IPC payloads and sender trust before widening any bridge API
- keep packaging changes aligned with `electron-builder.json`, `electron-builder-appx.json`, and `docs/packaging.md`
- for large tasks, delegate to the smallest suitable project subagent

The old generic caution guidelines are now folded into the canonical project contract in `AGENTS.md`.
