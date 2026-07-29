import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 15_000,
  // Electron launches a fresh app process for each serial scenario. Keep the
  // per-test timeout strict while allowing the complete integration suite to
  // finish on a developer machine.
  globalTimeout: 600_000,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
});
