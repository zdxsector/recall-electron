import { test, expect, type Page } from '@playwright/test';
import {
  closeIsolatedElectronApp,
  type IsolatedElectronApp,
  launchIsolatedElectronApp,
} from './helpers/electron-app';

const launchAuthApp = async (
  mockResult:
    | 'success'
    | 'cancel'
    | 'failure'
    | 'unavailable'
    | 'timeout' = 'cancel'
) =>
  launchIsolatedElectronApp({
    env: {
      SECURE_NOTES_AUTH_MOCK: '1',
      SECURE_NOTES_AUTH_MOCK_RESULT: mockResult,
    },
    seedLockedNotes: true,
    settleMs: 500,
  });

const setMockResult = async (
  appContext: IsolatedElectronApp,
  result: 'success' | 'cancel' | 'failure' | 'unavailable' | 'timeout'
) => {
  await appContext.electronApp.evaluate((_, nextResult) => {
    process.env.SECURE_NOTES_AUTH_MOCK_RESULT = nextResult;
  }, result);
};

const selectNote = async (window: Page, title: string) => {
  await window.locator('.note-list-item', { hasText: title }).first().click();
};

const getAuthEvents = async (window: Page) =>
  window.evaluate(() => window.electron.secureNotes.test.getEvents());

test.describe('locked note native auth mock mode', () => {
  let appContext: IsolatedElectronApp;
  let window: Page;

  test.afterEach(async () => {
    await closeIsolatedElectronApp(appContext);
  });

  test('selecting a locked note shows the locked screen and calls native auth show', async () => {
    appContext = await launchAuthApp('cancel');
    window = appContext.window;

    await selectNote(window, 'Locked QA Secret');
    await expect(window.locator('.note-editor--locked')).toBeVisible();
    await expect(window.getByText('This note is locked.')).toBeVisible();
    await expect(window.getByText(/Mock unlocked secret body/)).toHaveCount(0);

    await expect
      .poll(async () => {
        const events = await getAuthEvents(window);
        return events.some((item) => item.event === 'auth-overlay-show');
      })
      .toBe(true);
  });

  test('mock auth success makes the note editor visible', async () => {
    appContext = await launchAuthApp('success');
    window = appContext.window;

    await selectNote(window, 'Locked QA Secret');
    await expect(window.locator('.note-editor--locked')).toHaveCount(0);
    await expect(window.getByText(/Mock unlocked secret body/)).toBeVisible();
  });

  test('mock auth cancel keeps the note locked', async () => {
    appContext = await launchAuthApp('cancel');
    window = appContext.window;

    await selectNote(window, 'Locked QA Secret');
    await expect(window.locator('.note-editor--locked')).toBeVisible();
    await expect(
      window.getByText('Authentication was cancelled.')
    ).toBeVisible();
    await expect(window.getByText(/Mock unlocked secret body/)).toHaveCount(0);
  });

  test('mock auth failure keeps the note locked and shows safe error', async () => {
    appContext = await launchAuthApp('failure');
    window = appContext.window;

    await selectNote(window, 'Locked QA Secret');
    await expect(window.locator('.note-editor--locked')).toBeVisible();
    await expect(window.getByText('Authentication failed.')).toBeVisible();
    await expect(window.getByText(/Mock unlocked secret body/)).toHaveCount(0);
  });

  test('mock auth unavailable shows fallback UI', async () => {
    appContext = await launchAuthApp('unavailable');
    window = appContext.window;

    await selectNote(window, 'Locked QA Secret');
    await expect(window.locator('.note-editor--locked')).toBeVisible();
    await expect(window.getByText(/app-specific note password/i)).toBeVisible();
    await expect(window.locator('input[type="password"]')).toHaveCount(0);
  });

  test('switching from locked note to unlocked note hides native auth overlay', async () => {
    appContext = await launchAuthApp('cancel');
    window = appContext.window;

    await selectNote(window, 'Locked QA Secret');
    await expect(window.locator('.note-editor--locked')).toBeVisible();
    await selectNote(window, 'Alpha');

    await expect
      .poll(async () => {
        const events = await getAuthEvents(window);
        return events.some((item) => item.event === 'auth-overlay-hide');
      })
      .toBe(true);
  });

  test('switching locked notes cleans up old overlay and shows a new one', async () => {
    appContext = await launchAuthApp('cancel');
    window = appContext.window;

    await selectNote(window, 'Locked QA Secret');
    await expect(window.locator('.note-editor--locked')).toBeVisible();
    await selectNote(window, 'Second Locked QA');
    await expect(window.locator('.note-editor--locked')).toBeVisible();

    await expect
      .poll(async () => {
        const events = await getAuthEvents(window);
        const shows = events.filter(
          (item) => item.event === 'auth-overlay-show'
        );
        const hides = events.filter(
          (item) => item.event === 'auth-overlay-hide'
        );
        return shows.length >= 2 && hides.length >= 1;
      })
      .toBe(true);
  });

  test('resizing the window updates native auth overlay', async () => {
    appContext = await launchAuthApp('cancel');
    window = appContext.window;

    await selectNote(window, 'Locked QA Secret');
    const browserWindow = await appContext.electronApp.browserWindow(window);
    await browserWindow.evaluate((win) => {
      const bounds = win.getBounds();
      win.setBounds({
        ...bounds,
        width: bounds.width + 40,
        height: bounds.height + 20,
      });
    });

    await expect
      .poll(async () => {
        const events = await getAuthEvents(window);
        return events.some((item) => item.event === 'auth-overlay-update');
      })
      .toBe(true);
  });

  test('reload while auth is active cleans up stale overlay', async () => {
    appContext = await launchAuthApp('cancel');
    window = appContext.window;

    await selectNote(window, 'Locked QA Secret');
    await window.reload();
    await window.locator('.recall-app').waitFor({ timeout: 15_000 });

    await expect
      .poll(async () => {
        const events = await getAuthEvents(window);
        return events.some((item) => item.event === 'auth-overlay-hide');
      })
      .toBe(true);
  });

  test('closing the window while auth is active does not crash', async () => {
    appContext = await launchAuthApp('cancel');
    window = appContext.window;

    await selectNote(window, 'Locked QA Secret');
    await expect(window.locator('.note-editor--locked')).toBeVisible();
    await closeIsolatedElectronApp(appContext);
    appContext = undefined as unknown as IsolatedElectronApp;
  });

  test('non-success mock timeout path does not crash', async () => {
    appContext = await launchAuthApp('timeout');
    window = appContext.window;

    await selectNote(window, 'Locked QA Secret');
    await expect(window.locator('.note-editor--locked')).toBeVisible();
    await expect(window.getByText('Authentication timed out.')).toBeVisible();
  });

  test('mock result can change between attempts without real Touch ID', async () => {
    appContext = await launchAuthApp('cancel');
    window = appContext.window;

    await selectNote(window, 'Locked QA Secret');
    await expect(
      window.getByText('Authentication was cancelled.')
    ).toBeVisible();
    await setMockResult(appContext, 'success');
    await window.getByRole('button', { name: 'Unlock locked note' }).click();
    await expect(window.getByText(/Mock unlocked secret body/)).toBeVisible();
  });
});
