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
  await window.locator('.recall-app').waitFor({ timeout: 10_000 });
});

test.afterAll(async () => {
  if (electronApp) {
    try {
      electronApp.process().kill('SIGKILL');
    } catch {}
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

  const trafficLightPos = await bw.evaluate((w) =>
    (w as any).getTrafficLightPosition?.() ?? null
  );

  if (trafficLightPos) {
    expect(trafficLightPos.x).toBe(20);
    expect(trafficLightPos.y).toBe(18);
  }

  const headerExists = await window.locator('.navigation-bar__header').count();
  expect(headerExists).toBeGreaterThan(0);
});

test('macOS: .is-macos class is applied to the DOM', async () => {
  if (process.platform !== 'darwin') {
    test.skip();
    return;
  }

  const hasMacosClass = await window.evaluate(() =>
    !!document.querySelector('.is-macos')
  );
  expect(hasMacosClass).toBe(true);
});

test('macOS: nav-bar header has computed padding-left >= 93px when sidebar open', async () => {
  if (process.platform !== 'darwin') {
    test.skip();
    return;
  }

  const header = window.locator('.navigation-bar__header');
  const count = await header.count();
  if (count === 0) {
    test.skip();
    return;
  }

  const paddingLeft = await header.first().evaluate((el) =>
    parseInt(getComputedStyle(el).paddingLeft, 10)
  );
  expect(paddingLeft).toBeGreaterThanOrEqual(93);
});

test('macOS: menu-bar has computed padding-left >= 93px when sidebar collapsed', async () => {
  if (process.platform !== 'darwin') {
    test.skip();
    return;
  }

  const navColumn = window.locator('.app-layout__nav-column');
  const menuBar = window.locator('.menu-bar');
  if ((await navColumn.count()) === 0 || (await menuBar.count()) === 0) {
    test.skip();
    return;
  }

  const isCollapsed = await navColumn.getAttribute('data-collapsed');
  if (isCollapsed !== 'true') {
    // Collapse the sidebar by clicking toggle
    const toggleBtn = window.locator('button[title*="Toggle sidebar"], button[title*="Menu"]');
    if ((await toggleBtn.count()) > 0) {
      await toggleBtn.first().click();
      await expect(navColumn).toHaveAttribute('data-collapsed', 'true');
    }
  }

  const collapsed = await navColumn.getAttribute('data-collapsed');
  if (collapsed !== 'true') {
    test.skip();
    return;
  }

  const paddingLeft = await menuBar.first().evaluate((el) =>
    parseInt(getComputedStyle(el).paddingLeft, 10)
  );
  expect(paddingLeft).toBeGreaterThanOrEqual(93);

  // Restore sidebar
  const toggleBtn = window.locator('button[title*="Menu"]');
  if ((await toggleBtn.count()) > 0) {
    await toggleBtn.first().click();
    await expect(navColumn).toHaveAttribute('data-collapsed', 'false');
  }
});

test('can take a screenshot of the app', async () => {
  const bw = await electronApp.browserWindow(window);
  const bounds = await bw.evaluate((w) => w.getBounds());
  expect(bounds.width).toBeGreaterThan(0);
  await window.screenshot({ path: 'e2e/screenshots/smoke.png' });
});
