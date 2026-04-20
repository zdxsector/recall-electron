# AGENTS.md

This file is the canonical operating contract for AI agents working in `recall-electron`.

## Product summary

`recall-electron` is an offline-first Electron desktop notes application with:

- a main process entrypoint at `desktop/index.js` -> `desktop/app.js`
- a privileged preload bridge in `desktop/preload.js`
- a renderer application rooted in `lib/boot.ts`
- React 17 + Redux state management in `lib/state/`
- a vendored Muya editor source tree under `lib/muya/`
- packaging and updater flows based on `electron-builder`

## Source of truth

Read these in order for non-trivial work:

1. `AGENTS.md`
2. `.agents/project-contract.md`
3. `.agents/architecture/electron-architecture.md`
4. the relevant `.agents/agents/*.md`
5. the relevant `.agents/skills/*/SKILL.md`
6. `README.md` and `docs/packaging.md` when the task touches setup or release

## Working rules

- use `pnpm` only; do not introduce `npm`, `npx`, or `package-lock.json`
- make the smallest change that solves the user task
- keep main, preload, and renderer responsibilities clearly separated
- do not widen preload APIs casually; every new bridge method needs a security reason
- do not bypass `contextIsolation: true` or `nodeIntegration: false`
- preserve offline-first behavior unless the task explicitly changes product scope
- keep packaging changes cross-platform when feasible: macOS, Windows, Linux
- update documentation whenever the supported workflow changes

## Architecture boundaries

- `desktop/app.js`: BrowserWindow lifecycle, menus, protocol handling, updater wiring, native shell and dialog integration
- `desktop/preload.js`: exposed renderer bridge, note persistence helpers, filesystem adapters, clipboard and image helpers
- `lib/`: renderer app, state, dialogs, note editor, notebook UI, search, auth, and utility code
- `lib/muya/`: vendored editor implementation; treat as a high-risk area for wide regressions
- `desktop/updater/`: manual and auto-update orchestration
- `resources/`: release assets, icons, certificates, macOS entitlements

## Security invariants

- keep Electron security defaults hardened
- validate IPC channels, payload shape, and call direction
- never expose raw Node or Electron primitives directly to renderer code
- prefer narrow, intention-revealing bridge APIs over generic file-system access
- do not use `shell.openExternal` for untrusted or unsanitized input
- if remote content is introduced, require CSP, permission handling, sender validation, and sandbox review

## Package manager contract

Use these commands:

- install: `pnpm install --no-frozen-lockfile --config.legacy-peer-deps=true`
- dev: `pnpm dev`
- test: `pnpm test`
- lint: `pnpm lint`
- build: `pnpm build`
- package: `pnpm package:mac`, `pnpm package:win`, `pnpm package:linux`

Do not add `npm`-only instructions to docs, scripts, CI snippets, or agent prompts.

## Definition of done

A task is done only when all relevant items hold:

- code paths remain aligned with main/preload/renderer boundaries
- `pnpm` commands and docs stay consistent
- Electron security invariants are preserved
- affected tests or verification steps were run when feasible
- packaging or release docs are updated when behavior changes

## Agent routing

Prefer these specialists:

- `electron-architect`
- `desktop-ui-ux-designer`
- `preload-ipc-security`
- `electron-planner`
- `build-packaging`
- `performance-optimization`
- `dependency-runtime-upgrade`
- `qa-tester`
- `playwright-electron-tester`
- `renderer-app-agent`

## External references

This setup takes inspiration from:

- VoltAgent's `electron-pro` subagent pattern
- Claude Code project subagent docs
- Electron latest security guidance

Keep local agent prompts grounded in this repository first, not generic Electron templates.
