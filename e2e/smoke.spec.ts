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
  const navColumn = window.locator('.app-layout__nav-column');

  // When sidebar is open the toggle lives in the nav-bar header
  const navToggle = window.locator('.navigation-bar__header button[aria-label*="Toggle Sidebar"]');
  await expect(navToggle).toBeVisible({ timeout: 10_000 });

  await navToggle.click();
  await expect(navColumn).toHaveAttribute('data-collapsed', 'true');

  // When sidebar is collapsed the toggle lives in the menu-bar
  const menuToggle = window.locator('.menu-bar__sidebar-toggle button[aria-label*="Toggle Sidebar"]');
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

test('macOS: sidebar toggle clears traffic lights when sidebar collapsed', async () => {
  if (process.platform !== 'darwin') {
    test.skip();
    return;
  }

  const navColumn = window.locator('.app-layout__nav-column');
  const navToggle = window.locator('.navigation-bar__header button[aria-label*="Toggle Sidebar"]');
  const menuToggle = window.locator('.menu-bar__sidebar-toggle button[aria-label*="Toggle Sidebar"]');
  if ((await navColumn.count()) === 0 || (await navToggle.count()) === 0) {
    test.skip();
    return;
  }

  const isCollapsed = await navColumn.getAttribute('data-collapsed');
  if (isCollapsed !== 'true') {
    await navToggle.click();
    await expect(navColumn).toHaveAttribute('data-collapsed', 'true');
  }

  const btnLeft = await menuToggle.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    return rect.left;
  });
  expect(btnLeft).toBeGreaterThanOrEqual(70);

  // Restore sidebar
  await menuToggle.click();
  await expect(navColumn).toHaveAttribute('data-collapsed', 'false');
});

test('note list resize handle is present and draggable', async () => {
  // Click first note to ensure the editor is visible
  const noteItems = window.locator('.note-list-item');
  if ((await noteItems.count()) > 0) {
    await noteItems.first().click();
    await window.waitForTimeout(500);
  }

  const handle = window.locator('.app-layout__resize-handle');
  await expect(handle).toBeVisible({ timeout: 10_000 });

  const sourceColumn = window.locator('.app-layout__source-column');
  const widthBefore = await sourceColumn.evaluate((el) =>
    parseInt(getComputedStyle(el).width, 10)
  );

  const box = await handle.boundingBox();
  if (!box) {
    test.skip();
    return;
  }

  // Drag 80px to the right
  await window.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await window.mouse.down();
  await window.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2);
  await window.mouse.up();

  const widthAfter = await sourceColumn.evaluate((el) =>
    parseInt(getComputedStyle(el).width, 10)
  );
  expect(widthAfter).toBeGreaterThan(widthBefore);
  expect(widthAfter).toBeLessThanOrEqual(600);
  expect(widthAfter).toBeGreaterThanOrEqual(200);
});

test('can take a screenshot of the app', async () => {
  const bw = await electronApp.browserWindow(window);
  const bounds = await bw.evaluate((w) => w.getBounds());
  expect(bounds.width).toBeGreaterThan(0);
  await window.screenshot({ path: 'e2e/screenshots/smoke.png' });
});
