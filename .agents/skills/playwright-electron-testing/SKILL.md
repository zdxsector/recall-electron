---
name: playwright-electron-testing
description: use Playwright's official Electron automation APIs for end-to-end and smoke testing in Recall Electron.
---

# Playwright Electron testing

Primary reference:

- Playwright Electron API: `https://playwright.dev/docs/api/class-electron`

Default approach:

1. Use Playwright's `_electron` namespace, not plain browser-only Playwright.
2. Launch the app with `electron.launch(...)`.
3. Use `electronApp.firstWindow()` for renderer assertions.
4. Use `electronApp.evaluate(({ app }) => ...)` only for focused main-process checks.
5. Capture traces, screenshots, or video when the bug is visual or timing-sensitive.

Repo-specific guidance:

- use `pnpm` commands for setup and execution
- treat `desktop/index.js` as the main entrypoint
- prefer validating the real renderer window over mocking desktop behavior
- include offline persistence, notebooks, dialogs, title bar controls, and updater UX when relevant

Relevant Playwright details from the official docs:

- Electron automation is exposed via `const { _electron } = require('playwright')`
- `electron.launch()` accepts launch options such as `args`, `cwd`, `env`, `artifactsDir`, `recordHar`, `recordVideo`, `offline`, and `timeout`
- supported Electron versions listed there include `v12.2.0+`, `v13.4.0+`, and `v14+`
- the docs note Electron automation support is experimental
