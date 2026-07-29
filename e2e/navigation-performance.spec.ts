import { test, expect, type Page } from '@playwright/test';
import fs from 'fs';
import path from 'path';

import {
  closeIsolatedElectronApp,
  type IsolatedElectronApp,
  launchIsolatedElectronApp,
} from './helpers/electron-app';

let window: Page;
let appContext: IsolatedElectronApp;

test.describe('navigation performance', () => {
  test.beforeAll(async () => {
    appContext = await launchIsolatedElectronApp({
      seedNoteLines: 25_000,
      settleMs: 500,
    });
    window = appContext.window;
  });

  test.afterAll(async () => {
    await closeIsolatedElectronApp(appContext);
  });

  test('opening a folder does not rewrite a 25,000-line note', async () => {
    const notePath = path.join(
      appContext.notesRoot,
      'E2ENotebook',
      'E2ESeed',
      'Find Bar Seed',
      'Find Bar Seed.md'
    );
    const before = fs.statSync(notePath).mtimeMs;
    const folder = window.locator('.navigation-bar__folder-item').first();

    await folder.click();
    await expect(window.locator('.note-list')).toBeVisible();

    // The previous global persistence middleware saved every note one second
    // after this UI-only action. Wait beyond that window before checking.
    await window.waitForTimeout(1_250);

    expect(fs.statSync(notePath).mtimeMs).toBe(before);
  });
});
