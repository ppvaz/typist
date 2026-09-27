import { defineConfig, devices } from '@playwright/test';

/** Development server (fixtures available) and a production preview (service worker). */
export const DEV_URL = 'http://127.0.0.1:5174';
export const PREVIEW_URL = 'http://127.0.0.1:4174';

export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: DEV_URL,
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'npx vite --port 5174 --strictPort',
      url: DEV_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: 'npx vite build && npx vite preview --port 4174 --strictPort',
      url: PREVIEW_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
  ],
  projects: [
    { name: 'chrome', use: { ...devices['Desktop Chrome'], channel: 'chrome' } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
  ],
});
