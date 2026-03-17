import { defineConfig, devices } from '@playwright/test';

const host = '127.0.0.1';
const port = Number(process.env.PLAYWRIGHT_FE_PORT ?? '4173');
const baseURL = `http://${host}:${port}`;
const liveBackendBaseUrl = process.env.LIVE_API_BASE_URL
  ?? process.env.VITE_DEV_PROXY_TARGET
  ?? 'http://127.0.0.1:8080';
const proxyTarget = process.env.VITE_DEV_PROXY_TARGET
  ?? process.env.LIVE_API_BASE_URL
  ?? 'http://127.0.0.1:8080';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  timeout: 60_000,
  expect: {
    timeout: 15_000,
  },
  retries: process.env.CI ? 1 : 0,
  reporter: [
    ['list'],
    ['html', { open: 'never' }],
  ],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
      },
    },
  ],
  webServer: {
    command: `pnpm exec vite --host ${host} --port ${port} --strictPort`,
    url: baseURL,
    // Always start with a fresh server so CI/local share the same injected env contract.
    reuseExistingServer: false,
    env: {
      ...process.env,
      LIVE_API_BASE_URL: liveBackendBaseUrl,
      VITE_DEV_PROXY_TARGET: proxyTarget,
      // Force FE API calls to remain relative and flow through Vite proxy.
      VITE_API_BASE_URL: '',
    },
  },
});
