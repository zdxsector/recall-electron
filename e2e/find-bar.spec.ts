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
  // Allow time for notes to load from disk
  await window.waitForTimeout(2000);
});

test.afterAll(async () => {
  if (electronApp) {
    try {
      electronApp.process().kill('SIGKILL');
    } catch {}
  }
});

test('find bar: opens with Cmd+F on a note that has content', async () => {
  // Step 1: Select a note from the list. Prefer one with content.
  const noteItems = window.locator('.note-list-item');
  const count = await noteItems.count();

  if (count === 0) {
    test.skip();
    return;
  }

  // Click the first note to open it
  await noteItems.first().click();
  await window.waitForTimeout(800);

  // Confirm the editor shell is present
  const editorShell = window.locator('.note-content-editor-shell');
  await expect(editorShell).toBeVisible({ timeout: 8_000 });

  // Step 2: Verify find bar is NOT visible before Cmd+F
  const findBar = window.locator('.find-bar');
  await expect(findBar).not.toBeVisible();

  // Step 3: Press Cmd+F to open the find bar
  await window.keyboard.press('Meta+f');
  await window.waitForTimeout(300);

  // Step 4: Verify the find bar appears
  await expect(findBar).toBeVisible({ timeout: 5_000 });

  // Screenshot for visual reference
  await window.screenshot({ path: 'e2e/screenshots/find-bar-open.png' });
});

test('find bar: input is focused and accepts text after Cmd+F', async () => {
  // Find bar should already be open from the previous test (same beforeAll session)
  // In case it's not, re-open it.
  const findBar = window.locator('.find-bar');
  const isVisible = await findBar.isVisible();
  if (!isVisible) {
    await window.keyboard.press('Meta+f');
    await window.waitForTimeout(300);
    await expect(findBar).toBeVisible({ timeout: 5_000 });
  }

  // Step 5: Type a search term into the find bar input
  const findInput = window.locator('.find-bar__input');
  await expect(findInput).toBeVisible({ timeout: 3_000 });
  await expect(findInput).toBeFocused({ timeout: 3_000 });

  // Type a very common word that is likely to appear in any note
  await findInput.fill('');
  await findInput.type('e');
  await window.waitForTimeout(400);

  // Step 6: Verify the counter reflects results
  const counter = window.locator('.find-bar__count');
  await expect(counter).toBeVisible();
  const counterText = await counter.textContent();

  // Counter format is "{index}/{total}" — confirm it shows something
  expect(counterText).toBeTruthy();
  // "0/0" means no match; any other value means matches were found
  // We log the counter regardless; the assertion below captures both outcomes.
  console.log(`find-bar counter text: "${counterText}"`);

  // Screenshot showing the counter
  await window.screenshot({ path: 'e2e/screenshots/find-bar-counter.png' });
});

test('find bar: counter shows non-zero results for content-rich search', async () => {
  // Ensure find bar is open
  const findBar = window.locator('.find-bar');
  const isVisible = await findBar.isVisible();
  if (!isVisible) {
    const noteItems = window.locator('.note-list-item');
    if ((await noteItems.count()) > 0) {
      await noteItems.first().click();
      await window.waitForTimeout(600);
    }
    await window.keyboard.press('Meta+f');
    await window.waitForTimeout(300);
    await expect(findBar).toBeVisible({ timeout: 5_000 });
  }

  const findInput = window.locator('.find-bar__input');
  const counter = window.locator('.find-bar__count');

  // Try several common letters — at least one should yield a match in any note
  const candidates = ['e', 'a', 't', 'i', 'o', 'n'];
  let matchFound = false;

  for (const letter of candidates) {
    await findInput.fill(letter);
    await window.waitForTimeout(400);
    const text = await counter.textContent();
    console.log(`search "${letter}" => counter "${text}"`);
    if (text && text !== '0/0') {
      matchFound = true;
      break;
    }
  }

  expect(matchFound).toBe(true);
});

test('find bar: closes on Escape and disappears from DOM', async () => {
  // Make sure the find bar is open
  const findBar = window.locator('.find-bar');
  const isVisible = await findBar.isVisible();
  if (!isVisible) {
    await window.keyboard.press('Meta+f');
    await window.waitForTimeout(300);
    await expect(findBar).toBeVisible({ timeout: 5_000 });
  }

  // Step 7: Press Escape to close
  await window.keyboard.press('Escape');
  await window.waitForTimeout(300);

  // Step 8: Verify the find bar is gone
  await expect(findBar).not.toBeVisible({ timeout: 3_000 });

  // Screenshot confirming closure
  await window.screenshot({ path: 'e2e/screenshots/find-bar-closed.png' });
});
