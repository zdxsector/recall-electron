---
name: playwright-electron-testing
description: use Playwright's official Electron automation APIs for end-to-end and smoke testing in Recall Electron.
---

# Playwright Electron testing

Primary reference:

- Playwright Electron API: `https://playwright.dev/docs/api/class-electron`
- Playwright ElectronApplication API: `https://playwright.dev/docs/api/class-electronapplication`

## Setup

Playwright and `@playwright/test` are installed as dev dependencies. Run tests with:

```sh
pnpm test:e2e          # build + headless
pnpm test:e2e:headed   # build + visible window
```

## Default approach

1. Use Playwright's `_electron` namespace — never plain browser-only Playwright.
2. Launch the app via `electron.launch({ args: ['desktop/index.js'] })`.
3. Use `electronApp.firstWindow()` for renderer assertions.
4. Use `electronApp.evaluate(({ app }) => ...)` only for focused main-process checks.
5. Capture traces, screenshots, or video when the bug is visual or timing-sensitive.
6. **Always close the app** with `electronApp.close()` in `test.afterAll()`.

## Launching the Electron app

```typescript
import { _electron as electron } from 'playwright';
import path from 'path';

const electronApp = await electron.launch({
  args: [path.join(__dirname, '..', 'desktop', 'index.js')],
  cwd: path.join(__dirname, '..'),
  env: { ...process.env, NODE_ENV: 'development' },
});

const window = await electronApp.firstWindow();
await window.waitForLoadState('domcontentloaded');
```

## Key APIs

| Task | API |
|------|-----|
| Launch Electron | `electron.launch({ args, cwd, env })` |
| Get renderer window | `electronApp.firstWindow()` |
| Main-process eval | `electronApp.evaluate(({ app, BrowserWindow }) => ...)` |
| Close app | `electronApp.close()` |
| Multiple windows | `electronApp.windows()` |
| Wait for window | `electronApp.waitForEvent('window')` |
| BrowserWindow by page | `electronApp.browserWindow(page)` |
| Screenshot | `page.screenshot({ path })` |
| IPC from renderer | evaluate `window.electron.*` in the page context |

## Cleanup requirements

Every test file MUST:

1. Call `electronApp.close()` in `test.afterAll()` to quit the Electron process.
2. No dev server is needed — Electron loads the built app from `dist/` directly.
3. If the test starts a dev server (port 4000), kill it in cleanup:

```typescript
test.afterAll(async () => {
  await electronApp?.close();
  // Kill dev server if started
  const { execSync } = require('child_process');
  try { execSync('kill $(lsof -ti :4000)', { stdio: 'ignore' }); } catch {}
});
```

## Repo-specific guidance

- Use `pnpm` commands for setup and execution
- Treat `desktop/index.js` as the main entrypoint
- Run `pnpm run build:app` before launching if testing against the built bundle
- Prefer validating the real renderer window over mocking desktop behavior
- Include offline persistence, notebooks, dialogs, title bar controls, and updater UX when relevant
- Test files go in `e2e/` with `.spec.ts` extension
- Screenshots saved to `e2e/screenshots/`

## Testing macOS-specific features

```typescript
test('traffic light clearance on macOS', async () => {
  if (process.platform !== 'darwin') { test.skip(); return; }
  const header = window.locator('.navigation-bar__header');
  const padding = await header.evaluate(el => getComputedStyle(el).paddingLeft);
  expect(parseInt(padding)).toBeGreaterThanOrEqual(78);
});
```

## Testing with BrowserWindow properties

```typescript
const bw = await electronApp.browserWindow(window);
const { width, height } = await bw.evaluate(w => w.getBounds());
const isVisible = await bw.evaluate(w => w.isVisible());
const title = await bw.evaluate(w => w.getTitle());
```

## Supported Electron versions

Playwright supports Electron v12.2.0+, v13.4.0+, and v14+. This repo uses Electron 40.1.0.
The Electron automation support is marked as experimental by Playwright.
