/**
 * find-bar-scroll.spec.ts
 *
 * Verifies that pressing "next" in the find bar causes the editor to scroll
 * to the active match when there are matches below the initial viewport fold.
 *
 * The scroll container in this app is `.muya-editor-root`, which has
 * `overflow-y: auto` and `height: 100%`. The parent `.note-detail-wrapper`
 * uses `overflow: hidden`, which in Chromium can block `scrollIntoView()` from
 * reaching `.muya-editor-root`. The fix in `scrollToActiveMatch()` must set
 * `.muya-editor-root`'s `scrollTop` directly rather than relying on
 * `scrollIntoView()` traversing the ancestor chain past the hidden overflow wall.
 *
 * Screenshots are saved to e2e/screenshots/ for visual reference.
 */

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
  // Allow notes to load from disk
  await window.waitForTimeout(2000);
});

test.afterAll(async () => {
  if (electronApp) {
    try {
      electronApp.process().kill('SIGKILL');
    } catch {}
  }
});

/**
 * Returns the scrollTop, scrollHeight, and clientHeight of .muya-editor-root,
 * which is the designated scroll container (overflow-y: auto; height: 100%).
 * The parent .note-detail-wrapper uses overflow: hidden; in Chromium this can
 * block scrollIntoView() from reaching .muya-editor-root, which is the bug
 * these tests catch.
 */
async function getMuyaScrollDimensions(page: Page): Promise<{ scrollHeight: number; clientHeight: number; scrollTop: number }> {
  return page.evaluate(() => {
    const root = document.querySelector('.muya-editor-root') as HTMLElement | null;
    if (!root) return { scrollHeight: 0, clientHeight: 0, scrollTop: 0 };
    return {
      scrollHeight: root.scrollHeight,
      clientHeight: root.clientHeight,
      scrollTop: root.scrollTop,
    };
  });
}

/** Close the find bar if it is currently visible. */
async function closeFindBarIfOpen(page: Page) {
  const findBar = page.locator('.find-bar');
  if (!(await findBar.isVisible())) return;

  // Click the close button directly — more reliable than Escape which depends on focus.
  const closeBtn = page.locator('.find-bar__btn--close');
  if (await closeBtn.isVisible()) {
    await closeBtn.click();
    await page.waitForTimeout(300);
    return;
  }

  // Fallback: focus input then press Escape
  const findInput = page.locator('.find-bar__input');
  if (await findInput.isVisible()) {
    await findInput.click();
    await page.waitForTimeout(100);
  }
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
}

// ─── Test 1: next button scrolls ──────────────────────────────────────────────

test('find bar: next button scrolls editor to active match', async () => {
  // ----- Step 1: open a note -----
  const noteItems = window.locator('.note-list-item');
  const noteCount = await noteItems.count();

  if (noteCount === 0) {
    console.log('No notes found — skipping scroll test');
    test.skip();
    return;
  }

  await noteItems.first().click();
  await window.waitForTimeout(800);

  const editorShell = window.locator('.note-content-editor-shell');
  await expect(editorShell).toBeVisible({ timeout: 8_000 });

  // ----- Step 2: open the find bar -----
  await closeFindBarIfOpen(window);

  await window.keyboard.press('Meta+f');
  await window.waitForTimeout(400);

  const findBar = window.locator('.find-bar');
  await expect(findBar).toBeVisible({ timeout: 5_000 });

  // ----- Step 3: type a common letter to maximise match count -----
  const findInput = window.locator('.find-bar__input');
  await expect(findInput).toBeVisible({ timeout: 3_000 });
  await expect(findInput).toBeFocused({ timeout: 3_000 });

  const counter = window.locator('.find-bar__count');
  let matchesFound = false;
  let matchTotal = 0;

  for (const letter of ['e', 'a', 't', 'i', 'o', 'n', 's']) {
    await findInput.fill(letter);
    await window.waitForTimeout(500);
    const counterText = (await counter.textContent()) ?? '';
    console.log(`find-bar-scroll: search "${letter}" => "${counterText}"`);
    const parts = counterText.split('/');
    if (parts.length === 2) {
      const total = parseInt(parts[1], 10);
      if (!isNaN(total) && total > 0) {
        matchesFound = true;
        matchTotal = total;
        break;
      }
    }
  }

  if (!matchesFound) {
    console.log('No matches found for any candidate letter — skipping scroll assertion');
    await window.screenshot({ path: 'e2e/screenshots/find-bar-scroll-no-matches.png' });
    await closeFindBarIfOpen(window);
    test.skip();
    return;
  }

  console.log(`find-bar-scroll: ${matchTotal} total matches`);

  // ----- Step 4: record initial scroll state -----
  const dimsBefore = await getMuyaScrollDimensions(window);
  console.log(
    `find-bar-scroll: before — scrollTop=${dimsBefore.scrollTop} ` +
    `scrollHeight=${dimsBefore.scrollHeight} clientHeight=${dimsBefore.clientHeight}`
  );

  // Confirm content extends below the fold (test is only meaningful if it does)
  const hasContentBelowFold = dimsBefore.scrollHeight > dimsBefore.clientHeight;
  console.log(`find-bar-scroll: hasContentBelowFold=${hasContentBelowFold}`);

  await window.screenshot({ path: 'e2e/screenshots/find-bar-scroll-initial.png' });

  // ----- Step 5: click "next" many times -----
  // Layout: .find-bar__btn buttons in order are: [prev (up), next (down), close (×)]
  // The close button also has the modifier class .find-bar__btn--close, so we
  // select only non-close buttons and take index 1 (next / down arrow).
  const navButtons = window.locator('.find-bar__btn:not(.find-bar__btn--close)');
  const navCount = await navButtons.count();
  console.log(`find-bar-scroll: found ${navCount} navigation buttons (prev + next)`);

  const nextBtn = navButtons.nth(1);
  await expect(nextBtn).toBeVisible({ timeout: 3_000 });

  // Click next enough times to cycle well past the first screenful.
  const clickCount = Math.min(25, matchTotal);
  for (let i = 0; i < clickCount; i++) {
    await nextBtn.click();
    // Small pause so Muya can react before the next click
    await window.waitForTimeout(80);
  }

  // Allow any smooth-scroll animation to settle
  await window.waitForTimeout(500);

  // ----- Step 6: screenshot the scrolled state -----
  await window.screenshot({ path: 'e2e/screenshots/find-bar-scroll-after-next.png' });

  const dimsAfter = await getMuyaScrollDimensions(window);
  console.log(
    `find-bar-scroll: after ${clickCount} nexts — scrollTop=${dimsAfter.scrollTop} ` +
    `scrollHeight=${dimsAfter.scrollHeight} clientHeight=${dimsAfter.clientHeight}`
  );

  // ----- Step 7: verify the counter advanced -----
  const finalCounterText = (await counter.textContent()) ?? '';
  console.log(`find-bar-scroll: counter after navigation = "${finalCounterText}"`);

  const finalParts = finalCounterText.split('/');
  if (finalParts.length === 2) {
    const finalIndex = parseInt(finalParts[0], 10);
    const finalTotal = parseInt(finalParts[1], 10);
    // Counter must have advanced beyond position 1
    if (finalTotal > 1) {
      expect(finalIndex).not.toBe(1);
    }
  }

  // ----- Step 8: assert scroll position changed -----
  // Only assert when there is content below the fold AND many matches, so we
  // know the active match must have moved out of the initial viewport.
  if (hasContentBelowFold && matchTotal > 5) {
    // This assertion catches the regression: if scrollIntoView is blocked by the
    // overflow:hidden ancestor (.note-detail-wrapper), scrollTop stays at 0.
    expect(dimsAfter.scrollTop).toBeGreaterThan(dimsBefore.scrollTop);
    console.log(
      `find-bar-scroll: PASS — scrollTop moved from ${dimsBefore.scrollTop} ` +
      `to ${dimsAfter.scrollTop}`
    );
  } else {
    console.log(
      `find-bar-scroll: INFO — scroll assertion skipped ` +
      `(hasContentBelowFold=${hasContentBelowFold}, matchTotal=${matchTotal})`
    );
  }

  // ----- Cleanup -----
  await closeFindBarIfOpen(window);
});

// ─── Test 2: previous button decrements the counter ──────────────────────────

test('find bar: previous button navigates backwards (counter decrements)', async () => {
  const noteItems = window.locator('.note-list-item');
  if ((await noteItems.count()) === 0) {
    test.skip();
    return;
  }

  await noteItems.first().click();
  await window.waitForTimeout(600);

  await closeFindBarIfOpen(window);

  await window.keyboard.press('Meta+f');
  await window.waitForTimeout(400);

  const findBar = window.locator('.find-bar');
  await expect(findBar).toBeVisible({ timeout: 5_000 });

  const findInput = window.locator('.find-bar__input');
  const counter = window.locator('.find-bar__count');

  await findInput.fill('e');
  await window.waitForTimeout(500);

  const seedText = (await counter.textContent()) ?? '';
  const seedTotal = parseInt((seedText.split('/')[1] ?? '0'), 10);
  console.log(`find-bar-scroll (prev): seed counter "${seedText}"`);

  if (seedTotal < 2) {
    console.log('Fewer than 2 matches — skipping prev test');
    await closeFindBarIfOpen(window);
    test.skip();
    return;
  }

  // Navigate forward several steps so previous has room to move back
  const navButtons = window.locator('.find-bar__btn:not(.find-bar__btn--close)');
  const nextBtn = navButtons.nth(1);
  const prevBtn = navButtons.nth(0);

  for (let i = 0; i < 5; i++) {
    await nextBtn.click();
    await window.waitForTimeout(80);
  }
  await window.waitForTimeout(300);

  const textAfterNext = (await counter.textContent()) ?? '';
  const indexAfterNext = parseInt((textAfterNext.split('/')[0] ?? '0'), 10);
  console.log(`find-bar-scroll (prev): after 5 nexts = "${textAfterNext}"`);

  // Press previous once
  await prevBtn.click();
  await window.waitForTimeout(300);

  const textAfterPrev = (await counter.textContent()) ?? '';
  const indexAfterPrev = parseInt((textAfterPrev.split('/')[0] ?? '0'), 10);
  console.log(`find-bar-scroll (prev): after 1 prev = "${textAfterPrev}"`);

  // Index must have changed (decreased by 1, or wrapped from 1 → total)
  expect(indexAfterPrev).not.toBe(indexAfterNext);

  await window.screenshot({ path: 'e2e/screenshots/find-bar-scroll-prev.png' });

  // Cleanup — best effort, do not assert close since it is not this test's concern
  await closeFindBarIfOpen(window);
});
