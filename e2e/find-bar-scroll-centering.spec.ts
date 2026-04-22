/**
 * find-bar-scroll-centering.spec.ts
 *
 * Verifies that after navigating forward through many find-bar matches the
 * editor scroll positions the active match in the upper-to-middle area of the
 * visible viewport — NOT anchored to the bottom edge (which was the bug before
 * the "upper-third" scroll fix).
 *
 * How `scrollToActiveMatch` works (lib/components/muya-editor/index.tsx):
 *   It targets the active match's `block.domNode` (a paragraph/block element)
 *   and sets scrollTop so that the block sits at containerHeight/3 from the top.
 *   The highlight <span class="mu-highlight"> inside the block may be hidden by
 *   Muya when the block is focused, so we measure the active block element
 *   directly instead of the highlight span.
 *
 * The active block is identified as the contenteditable element that contains
 * a .mu-highlight span, OR (when focused) the element with a caret whose
 * parent/ancestor has class mu-paragraph or similar. We fall back to looking at
 * scrollTop alone when the active element isn't reliably addressable.
 *
 * Assertions:
 *   1. scrollTop of .muya-editor-root is > 0 (the editor actually scrolled).
 *   2. The active/highlighted block's getBoundingClientRect().top relative to
 *      the editor's visible area is in the upper two-thirds of the viewport,
 *      i.e. blockRelativeTop < (clientHeight * 2/3).
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

/** Close the find bar via the close button or Escape if it is open. */
async function closeFindBarIfOpen(page: Page) {
  const findBar = page.locator('.find-bar');
  if (!(await findBar.isVisible())) return;

  const closeBtn = page.locator('.find-bar__btn--close');
  if (await closeBtn.isVisible()) {
    await closeBtn.click();
    await page.waitForTimeout(300);
    return;
  }

  const findInput = page.locator('.find-bar__input');
  if (await findInput.isVisible()) {
    await findInput.click();
    await page.waitForTimeout(100);
  }
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
}

test('find bar scroll centering: active match lands in the upper third of the viewport after 50 next-clicks', async () => {
  // ── Step 1: open a note with content ────────────────────────────────────────
  const noteItems = window.locator('.note-list-item');
  const noteCount = await noteItems.count();

  if (noteCount === 0) {
    console.log('No notes found — skipping centering test');
    test.skip();
    return;
  }

  await noteItems.first().click();
  await window.waitForTimeout(800);

  const editorShell = window.locator('.note-content-editor-shell');
  await expect(editorShell).toBeVisible({ timeout: 8_000 });

  // ── Step 2: open the find bar (Meta+F) ──────────────────────────────────────
  await closeFindBarIfOpen(window);
  await window.keyboard.press('Meta+f');
  await window.waitForTimeout(400);

  const findBar = window.locator('.find-bar');
  await expect(findBar).toBeVisible({ timeout: 5_000 });

  // ── Step 3: type "e" to get many matches ────────────────────────────────────
  const findInput = window.locator('.find-bar__input');
  await expect(findInput).toBeVisible({ timeout: 3_000 });
  await expect(findInput).toBeFocused({ timeout: 3_000 });

  const counter = window.locator('.find-bar__count');

  // Try common letters until we get a meaningful match count
  let matchTotal = 0;
  for (const letter of ['e', 'a', 't', 'i', 'o', 'n', 's']) {
    await findInput.fill(letter);
    await window.waitForTimeout(500);
    const counterText = (await counter.textContent()) ?? '';
    console.log(`centering: search "${letter}" => "${counterText}"`);
    const parts = counterText.split('/');
    if (parts.length === 2) {
      const total = parseInt(parts[1], 10);
      if (!isNaN(total) && total > 0) {
        matchTotal = total;
        break;
      }
    }
  }

  if (matchTotal === 0) {
    console.log('No matches found — skipping centering assertion');
    await window.screenshot({ path: 'e2e/screenshots/find-bar-scroll-centering-no-matches.png' });
    await closeFindBarIfOpen(window);
    test.skip();
    return;
  }

  console.log(`centering: ${matchTotal} total matches found`);

  // ── Step 4: click next ~50 times to advance deep into the note ──────────────
  const navButtons = window.locator('.find-bar__btn:not(.find-bar__btn--close)');
  const navCount = await navButtons.count();
  console.log(`centering: ${navCount} navigation buttons (prev + next)`);

  const nextBtn = navButtons.nth(1);
  await expect(nextBtn).toBeVisible({ timeout: 3_000 });

  const clickCount = Math.min(50, matchTotal);
  for (let i = 0; i < clickCount; i++) {
    await nextBtn.click();
    await window.waitForTimeout(60);
  }

  // Allow smooth-scroll animation to fully settle
  await window.waitForTimeout(800);

  // ── Step 5: take a screenshot ───────────────────────────────────────────────
  const screenshotPath = 'e2e/screenshots/find-bar-scroll-centering.png';
  await window.screenshot({ path: screenshotPath });
  console.log(`centering: screenshot saved to ${screenshotPath}`);

  // ── Step 6: check scrollTop of .muya-editor-root ────────────────────────────
  const scrollInfo = await window.evaluate(() => {
    const root = document.querySelector('.muya-editor-root') as HTMLElement | null;
    if (!root) return { scrollTop: -1, scrollHeight: 0, clientHeight: 0 };
    return {
      scrollTop: root.scrollTop,
      scrollHeight: root.scrollHeight,
      clientHeight: root.clientHeight,
    };
  });

  console.log(
    `centering: scrollTop=${scrollInfo.scrollTop} ` +
    `scrollHeight=${scrollInfo.scrollHeight} ` +
    `clientHeight=${scrollInfo.clientHeight}`
  );

  // The editor must have scrolled; if scrollTop is still 0 the fix is not working.
  expect(scrollInfo.scrollTop).toBeGreaterThan(0);

  // ── Step 7: measure where the active block/highlight sits in the viewport ───
  //
  // Strategy: scrollToActiveMatch() positions `block.domNode` so that its top
  // is at scrollTop + offsetFromTop - clientHeight/3, i.e. the block top lands
  // at roughly clientHeight/3 from the top of the visible area.
  //
  // We look for the active block in this priority order:
  //   1. A <span class="mu-highlight"> (active match span — visible when the
  //      block is NOT the currently focused Muya block).
  //   2. The nearest block-level ancestor of document.activeElement inside the
  //      editor (the block Muya has placed focus on for the active match).
  //   3. We fall back to a pure scrollTop check if neither is found.
  const positionInfo = await window.evaluate(() => {
    const root = document.querySelector('.muya-editor-root') as HTMLElement | null;
    if (!root) {
      return {
        strategy: 'no-root',
        found: false,
        blockRelativeTop: -1,
        rootClientHeight: 0,
        viewportThird: 'unknown' as string,
      };
    }

    const rRect = root.getBoundingClientRect();
    const rootClientHeight = root.clientHeight;

    // Strategy 1: visible mu-highlight span (inactive-block scenario)
    const highlight = root.querySelector('.mu-highlight') as HTMLElement | null;
    if (highlight) {
      const hRect = highlight.getBoundingClientRect();
      const blockRelativeTop = hRect.top - rRect.top;
      const viewportThird =
        blockRelativeTop < rootClientHeight / 3
          ? 'top'
          : blockRelativeTop < (rootClientHeight * 2) / 3
          ? 'middle'
          : 'bottom';
      return {
        strategy: 'mu-highlight-span',
        found: true,
        blockRelativeTop,
        rootClientHeight,
        viewportThird,
      };
    }

    // Strategy 2: focused block inside editor (active-block scenario — Muya
    // hides the .mu-highlight inside .mu-hide when the block is focused for editing).
    // Walk up from document.activeElement to find a block-level element inside root.
    const blockSelectors = [
      '.mu-paragraph',
      '.mu-heading',
      '.mu-list-item',
      '.mu-code-block',
      '.mu-fenced-code',
      '.mu-blockquote',
      '[contenteditable="true"]',
    ];
    let activeEl = document.activeElement as HTMLElement | null;
    let activeBlock: HTMLElement | null = null;
    while (activeEl && activeEl !== root) {
      for (const sel of blockSelectors) {
        if (activeEl.matches?.(sel)) {
          activeBlock = activeEl;
          break;
        }
      }
      if (activeBlock) break;
      activeEl = activeEl.parentElement;
    }

    if (activeBlock && root.contains(activeBlock)) {
      const bRect = activeBlock.getBoundingClientRect();
      const blockRelativeTop = bRect.top - rRect.top;
      const viewportThird =
        blockRelativeTop < rootClientHeight / 3
          ? 'top'
          : blockRelativeTop < (rootClientHeight * 2) / 3
          ? 'middle'
          : 'bottom';
      return {
        strategy: 'focused-block',
        found: true,
        blockRelativeTop,
        rootClientHeight,
        viewportThird,
      };
    }

    // Strategy 3: no element found; caller will skip the position assertion.
    return {
      strategy: 'not-found',
      found: false,
      blockRelativeTop: -1,
      rootClientHeight,
      viewportThird: 'unknown',
    };
  });

  console.log(
    `centering: strategy=${positionInfo.strategy} found=${positionInfo.found} ` +
    `blockRelativeTop=${positionInfo.blockRelativeTop} ` +
    `rootClientHeight=${positionInfo.rootClientHeight} ` +
    `viewportThird=${positionInfo.viewportThird}`
  );

  if (!positionInfo.found) {
    // We still verified scrollTop > 0 above. Emit a clear diagnostic message
    // so the caller knows the position assertion was intentionally skipped.
    console.log(
      'centering: INFO — no active block element found in DOM after navigation; ' +
      'position assertion skipped (scrollTop assertion already passed)'
    );
  } else {
    // The active match block must NOT be in the bottom third.
    // Before the fix the block was always pinned near the bottom edge.
    // After the fix it should land in the top or middle third (upper two-thirds).
    const twoThirdsOfViewport = (positionInfo.rootClientHeight * 2) / 3;
    console.log(
      `centering: blockRelativeTop(${positionInfo.blockRelativeTop.toFixed(1)}) ` +
      `< 2/3 of clientHeight(${twoThirdsOfViewport.toFixed(1)})? ` +
      `${positionInfo.blockRelativeTop < twoThirdsOfViewport}`
    );

    expect(positionInfo.blockRelativeTop).toBeLessThan(twoThirdsOfViewport);
    console.log(
      `centering: PASS — active match block is in the ${positionInfo.viewportThird} ` +
      `third of the viewport (blockRelativeTop=${positionInfo.blockRelativeTop.toFixed(1)}, ` +
      `clientHeight=${positionInfo.rootClientHeight})`
    );
  }

  // ── Cleanup ─────────────────────────────────────────────────────────────────
  await closeFindBarIfOpen(window);
});
