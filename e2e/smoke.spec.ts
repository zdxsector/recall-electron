import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { _electron as electron } from 'playwright';
import path from 'path';

let electronApp: ElectronApplication;
let window: Page;

test.beforeAll(async () => {
  electronApp = await electron.launch({
    args: [path.join(__dirname, '..', 'desktop', 'index.js')],
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      NODE_ENV: 'test',
    },
  });

  window = await electronApp.firstWindow();
  await window.waitForLoadState('domcontentloaded');
  await window.waitForTimeout(2000);
});

test.afterAll(async () => {
  if (electronApp) {
    await electronApp.close();
  }
});

test('app window opens with correct title', async () => {
  const title = await window.title();
  expect(title).toBe('Recall');
});

test('main process is running', async () => {
  const isPackaged = await electronApp.evaluate(({ app }) => app.isPackaged);
  expect(isPackaged).toBe(false);
});

test('sidebar renders with navigation items', async () => {
  const allNotes = window.locator('text=All Notes');
  await expect(allNotes).toBeVisible({ timeout: 15_000 });

  const trash = window.locator('text=Trash');
  await expect(trash).toBeVisible();

  const settings = window.locator('text=Settings');
  await expect(settings).toBeVisible();
});

test('search field is present', async () => {
  const searchInput = window.locator('[placeholder="Search all notes and tags"]');
  await expect(searchInput).toBeVisible({ timeout: 10_000 });
});

test('sidebar toggle collapses and expands', async () => {
  const toggleBtn = window.locator('button[title="Toggle sidebar"]');
  await expect(toggleBtn).toBeVisible({ timeout: 10_000 });

  await toggleBtn.click();
  const navColumn = window.locator('.app-layout__nav-column');
  await expect(navColumn).toHaveAttribute('data-collapsed', 'true');

  const menuToggle = window.locator('button[aria-label*="Menu"]');
  await expect(menuToggle).toBeVisible({ timeout: 5_000 });
  await menuToggle.click();
  await expect(navColumn).toHaveAttribute('data-collapsed', 'false');
});

test('macOS window has frameless titlebar with traffic lights', async () => {
  if (process.platform !== 'darwin') {
    test.skip();
    return;
  }

  const bw = await electronApp.browserWindow(window);

  const titleBarStyle = await bw.evaluate((w) => {
    const options = (w as any)._options || {};
    return (w as any).titleBarStyle ?? options.titleBarStyle ?? null;
  });

  const trafficLightPos = await bw.evaluate((w) =>
    (w as any).getTrafficLightPosition?.() ?? null
  );

  if (trafficLightPos) {
    expect(trafficLightPos.x).toBe(20);
    expect(trafficLightPos.y).toBe(18);
  }

  const headerExists = await window.locator('.navigation-bar__header').count();
  expect(headerExists).toBeGreaterThan(0);

  const hasPaddingRule = await window.evaluate(() => {
    const sheets = Array.from(document.styleSheets);
    for (const sheet of sheets) {
      try {
        for (const rule of Array.from(sheet.cssRules)) {
          if (rule.cssText?.includes('.is-macos') &&
              rule.cssText?.includes('padding-left') &&
              rule.cssText?.includes('78px')) {
            return true;
          }
        }
      } catch {}
    }
    return false;
  });
  expect(hasPaddingRule).toBe(true);
});

test('can take a screenshot of the app', async () => {
  const bw = await electronApp.browserWindow(window);
  const bounds = await bw.evaluate((w) => w.getBounds());
  expect(bounds.width).toBeGreaterThan(0);
  await window.screenshot({ path: 'e2e/screenshots/smoke.png' });
});
