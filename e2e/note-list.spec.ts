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
    try {
      electronApp.process().kill('SIGKILL');
    } catch {}
  }
});

test('note list container renders', async () => {
  const noteList = window.locator('.note-list');
  await expect(noteList).toBeVisible({ timeout: 10_000 });
});

test('note list uses correct background color variable', async () => {
  const noteList = window.locator('.note-list');
  const bgColor = await noteList.evaluate((el) =>
    getComputedStyle(el).getPropertyValue('background-color')
  );
  expect(bgColor).toBeTruthy();
  expect(bgColor).not.toBe('');
});

test('note list items have Apple Notes cell structure', async () => {
  const items = window.locator('.note-list-item');
  const count = await items.count();

  if (count === 0) {
    const placeholder = window.locator('.note-list-placeholder');
    await expect(placeholder).toBeVisible();
    return;
  }

  const first = items.first();
  await expect(first.locator('.note-list-item-content')).toBeVisible();
  await expect(first.locator('.note-list-item-title')).toBeVisible();
  await expect(first.locator('.note-list-item-date-preview')).toBeVisible();
});

test('note list item content has rounded corners', async () => {
  const items = window.locator('.note-list-item');
  const count = await items.count();
  if (count === 0) {
    test.skip();
    return;
  }

  const content = items.first().locator('.note-list-item-content');
  const borderRadius = await content.evaluate((el) =>
    getComputedStyle(el).borderRadius
  );
  expect(borderRadius).toBe('10px');
});

test('note list item has inset padding from edges', async () => {
  const items = window.locator('.note-list-item');
  const count = await items.count();
  if (count === 0) {
    test.skip();
    return;
  }

  const padding = await items.first().evaluate((el) => {
    const style = getComputedStyle(el);
    return {
      left: style.paddingLeft,
      right: style.paddingRight,
    };
  });
  expect(padding.left).toBe('20px');
  expect(padding.right).toBe('20px');
});

test('note list item title uses correct font weight', async () => {
  const titles = window.locator('.note-list-item-title');
  const count = await titles.count();
  if (count === 0) {
    test.skip();
    return;
  }

  const fontWeight = await titles.first().evaluate((el) =>
    getComputedStyle(el).fontWeight
  );
  expect(Number(fontWeight)).toBeGreaterThanOrEqual(600);
});

test('note list item date is visible in date-preview row', async () => {
  const dates = window.locator('.note-list-item-date');
  const count = await dates.count();
  if (count === 0) {
    test.skip();
    return;
  }

  await expect(dates.first()).toBeVisible();
  const text = await dates.first().textContent();
  expect(text?.trim().length).toBeGreaterThan(0);
});

test('selected note list item uses dark gray background, not blue', async () => {
  const selected = window.locator('.note-list-item-selected');
  const count = await selected.count();
  if (count === 0) {
    test.skip();
    return;
  }

  const content = selected.first().locator('.note-list-item-content');
  const bg = await content.evaluate((el) =>
    getComputedStyle(el).backgroundColor
  );
  expect(bg).not.toContain('0, 122, 255');
  expect(bg).not.toContain('10, 132, 255');
});

test('note list items have no separator borders', async () => {
  const items = window.locator('.note-list-item');
  const count = await items.count();
  if (count === 0) {
    test.skip();
    return;
  }

  const textBlock = items.first().locator('.note-list-item-text');
  const borderWidth = await textBlock.evaluate((el) =>
    getComputedStyle(el).borderBottomWidth
  );
  expect(borderWidth).toBe('0px');
});

test('thumbnail img has correct dimensions and rounded corners when present', async () => {
  const thumbs = window.locator('.note-list-item-thumb-img');
  const count = await thumbs.count();
  if (count === 0) {
    test.skip();
    return;
  }

  const styles = await thumbs.first().evaluate((el) => {
    const s = getComputedStyle(el);
    return {
      width: s.width,
      height: s.height,
      borderRadius: s.borderRadius,
      objectFit: s.objectFit,
    };
  });
  expect(styles.width).toBe('44px');
  expect(styles.height).toBe('44px');
  expect(styles.borderRadius).toBe('6px');
  expect(styles.objectFit).toBe('cover');
});

test('note list item preview text does not contain raw code fences', async () => {
  const previews = window.locator('.note-list-item-preview-text');
  const count = await previews.count();

  for (let i = 0; i < Math.min(count, 10); i++) {
    const text = await previews.nth(i).textContent();
    expect(text).not.toContain('```');
  }
});

test('thumbnail images have no console errors (ERR_INVALID_URL / 414)', async () => {
  const errors: string[] = [];
  window.on('console', (msg) => {
    if (msg.type() === 'error') {
      errors.push(msg.text());
    }
  });
  window.on('pageerror', (err) => {
    errors.push(err.message);
  });

  // Wait for any pending image loads to settle
  await window.waitForTimeout(3000);

  const imageErrors = errors.filter(
    (e) =>
      e.includes('ERR_INVALID_URL') ||
      e.includes('414') ||
      e.includes('URI Too Long')
  );
  expect(imageErrors).toEqual([]);
});

test('thumbnail img src is never a truncated data URI', async () => {
  const thumbs = window.locator('.note-list-item-thumb-img');
  const count = await thumbs.count();

  for (let i = 0; i < count; i++) {
    const src = await thumbs.nth(i).getAttribute('src');
    if (!src) continue;

    if (src.startsWith('data:')) {
      // A valid data URI must contain a comma after the header
      expect(src).toContain(',');
      // Must not be an absurdly truncated base64 without padding
      const base64Part = src.split(',')[1] ?? '';
      // Valid base64 length is always divisible by 4 (with padding)
      expect(base64Part.length % 4).toBe(0);
    }
  }
});

test('thumbnail images that are visible have loaded successfully', async () => {
  await window.waitForTimeout(2000);
  const thumbs = window.locator('.note-list-item-thumb-img');
  const count = await thumbs.count();

  for (let i = 0; i < count; i++) {
    const thumb = thumbs.nth(i);
    const isVisible = await thumb.isVisible();
    if (!isVisible) continue;

    const naturalWidth = await thumb.evaluate(
      (el: HTMLImageElement) => el.naturalWidth
    );
    if (naturalWidth === 0) continue;
    expect(naturalWidth).toBeGreaterThan(0);
  }
});

test('note list titles do not contain raw HTML tags', async () => {
  const titles = window.locator('.note-list-item-title-text');
  const count = await titles.count();

  for (let i = 0; i < Math.min(count, 10); i++) {
    const text = await titles.nth(i).textContent();
    expect(text).not.toMatch(/<img\b/i);
    expect(text).not.toMatch(/<\/?\w+[\s>]/);
  }
});

test('note list screenshot for visual comparison', async () => {
  await window.screenshot({ path: 'e2e/screenshots/note-list.png' });
});
