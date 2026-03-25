import { defineConfig, devices } from '@playwright/test';
import { loadEnv } from 'vite';

const loadedEnv = loadEnv(process.env.NODE_ENV ?? 'development', process.cwd(), '');
const configEnv = {
  ...loadedEnv,
  ...process.env,
};

const host = '127.0.0.1';
const port = Number(configEnv.PLAYWRIGHT_FE_PORT ?? '4173');
const baseURL = `http://${host}:${port}`;
const requestedArgs = process.argv.slice(2);
const usesMockedAdminMonitoringFixture = requestedArgs.some((arg) =>
  arg.includes('admin-monitoring.spec.ts') && !arg.includes('/live/'),
);
const defaultAdminMonitoringPanelsJson = JSON.stringify([
  {
    key: 'executionVolume',
    title: 'Execution volume',
    description: 'Order execution throughput panel',
    mode: 'link',
    linkUrl: 'https://grafana.fix.local/d/ops/exec-volume',
    dashboardUid: 'ops-overview',
    panelId: 11,
    sourceMetricHint: 'http_server_requests_seconds / execution throughput',
    freshness: {
      source: 'grafana-panel',
      indicatorLabel: 'Grafana panel freshness',
      lastUpdatedLabel: 'Last updated',
      status: 'live',
      statusMessage: 'Freshness OK',
      lastUpdatedAt: '2026-03-24T09:15:00Z',
    },
    drillDown: {
      grafanaUrl: 'https://grafana.fix.local/d/ops/exec-volume?viewPanel=11',
      adminAuditUrl: '/admin?auditEventType=ORDER_EXECUTE',
    },
  },
  {
    key: 'pendingSessions',
    title: 'Pending sessions',
    description: 'Order session recovery backlog',
    mode: 'link',
    linkUrl: 'https://grafana.fix.local/d/ops/pending-sessions',
    dashboardUid: 'ops-overview',
    panelId: 12,
    sourceMetricHint: 'channel.order.recovery.*',
    freshness: {
      source: 'grafana-panel',
      indicatorLabel: 'Grafana panel freshness',
      lastUpdatedLabel: 'Last updated',
      status: 'stale',
      statusMessage: 'Scrape delay detected',
      lastUpdatedAt: '2026-03-24T09:00:00Z',
    },
    drillDown: {
      grafanaUrl: 'https://grafana.fix.local/d/ops/pending-sessions?viewPanel=12',
      adminAuditUrl: '/admin?auditEventType=ORDER_RECOVERY',
    },
  },
  {
    key: 'marketDataIngest',
    title: 'Market data ingest',
    description: 'Market data pipeline health',
    mode: 'embed',
    linkUrl: 'https://grafana.fix.local/d/ops/market-data',
    embedUrl: 'https://grafana.fix.local/d-solo/ops/market-data?panelId=13',
    dashboardUid: 'ops-overview',
    panelId: 13,
    sourceMetricHint: 'fep.marketdata.*',
    freshness: {
      source: 'grafana-companion-panel',
      indicatorLabel: 'Companion freshness panel',
      lastUpdatedLabel: 'Last updated',
      companionPanelUrl: 'https://grafana.fix.local/d/ops/market-data?viewPanel=31',
      status: 'unavailable',
      statusMessage: 'Check ingest freshness',
      lastUpdatedAt: '2026-03-24T08:52:00Z',
    },
    drillDown: {
      grafanaUrl: 'https://grafana.fix.local/d/ops/market-data?viewPanel=13',
    },
  },
]);
const liveBackendBaseUrl = configEnv.LIVE_API_BASE_URL
  ?? configEnv.VITE_DEV_PROXY_TARGET
  ?? 'http://127.0.0.1:8080';
const proxyTarget = configEnv.VITE_DEV_PROXY_TARGET
  ?? configEnv.LIVE_API_BASE_URL
  ?? 'http://127.0.0.1:8080';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  timeout: 60_000,
  expect: {
    timeout: 15_000,
  },
  retries: configEnv.CI ? 1 : 0,
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
    // Mocked admin-monitoring runs need a fresh Vite env contract, so do not reuse
    // an already-running local server that may have been started without the fixture.
    reuseExistingServer: !configEnv.CI && !usesMockedAdminMonitoringFixture,
    env: {
      ...configEnv,
      LIVE_API_BASE_URL: liveBackendBaseUrl,
      VITE_DEV_PROXY_TARGET: proxyTarget,
      // Force FE API calls to remain relative and flow through Vite proxy.
      VITE_API_BASE_URL: '',
      ...(usesMockedAdminMonitoringFixture
        ? {
            VITE_ADMIN_MONITORING_PANELS_JSON:
              configEnv.VITE_ADMIN_MONITORING_PANELS_JSON ?? defaultAdminMonitoringPanelsJson,
          }
        : {}),
    },
  },
});
