# Claude Project Settings

Use [`CLAUDE.md`](/Users/sly/Workspace/Personal/recall-electron/CLAUDE.md) as the primary instruction entrypoint.

Project expectations:

- use the smallest suitable subagent
- default all commands and examples to `pnpm`
- treat Electron main, preload, renderer, and packaging as separate ownership zones
- invoke the preload/IPC security specialist before widening bridge APIs
- invoke build/packaging guidance before touching installer or release files
- route Electron UI automation and smoke tests through Playwright-focused tester roles
