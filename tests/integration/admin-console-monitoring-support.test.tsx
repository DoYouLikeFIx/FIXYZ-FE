import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

import {
  getPathname,
  installMockAxiosModule,
  successEnvelope,
} from '../fixtures/mockAxiosModule';

const monitoringPanelsConfig = JSON.stringify([
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
      lastUpdatedLabel: '마지막 갱신',
      status: 'live',
      statusMessage: '실시간 scrape 정상',
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
      lastUpdatedLabel: '마지막 갱신',
      status: 'stale',
      statusMessage: 'scrape 지연 감지',
      lastUpdatedAt: '2026-03-24T09:00:00Z',
    },
    drillDown: {
      grafanaUrl: 'https://grafana.fix.local/d/ops/pending-sessions?viewPanel=12',
      adminAuditUrl: '/admin?auditEventType=ORDER_SESSION_CREATE',
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
      lastUpdatedLabel: '마지막 갱신',
      companionPanelUrl: 'https://grafana.fix.local/d/ops/market-data?viewPanel=31',
      status: 'unavailable',
      statusMessage: '수집 상태를 확인해 주세요',
      lastUpdatedAt: '2026-03-24T08:52:00Z',
    },
    drillDown: {
      grafanaUrl: 'https://grafana.fix.local/d/ops/market-data?viewPanel=13',
    },
  },
]);

describe.sequential('AdminConsolePage monitoring support integration', () => {
  afterEach(() => {
    cleanup();
    vi.doUnmock('axios');
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('keeps force-logout and audit search behavior alive alongside monitoring cards', async () => {
    vi.stubEnv('VITE_ADMIN_MONITORING_PANELS_JSON', monitoringPanelsConfig);

    const { calls } = await installMockAxiosModule((request) => {
      if (request.method === 'GET' && getPathname(request.url) === '/api/v1/auth/csrf') {
        return successEnvelope({
          token: 'csrf-admin-console-monitoring',
          headerName: 'X-CSRF-TOKEN',
        });
      }

      if (request.method === 'GET' && getPathname(request.url) === '/api/v1/admin/audit-logs') {
        const url = new URL(request.url, 'http://localhost');
        const eventType = url.searchParams.get('eventType');

        if (eventType === 'ORDER_EXECUTE') {
          return successEnvelope({
            content: [
              {
                auditId: 'log-order-execute',
                memberUuid: 'member-001',
                email: 'member-001@example.com',
                eventType: 'ORDER_EXECUTE',
                ipAddress: '127.0.0.1',
                userAgent: 'playwright',
                description: 'executed from monitoring drill-down',
                clOrdId: 'cl-001',
                orderSessionId: 'session-001',
                createdAt: '2026-03-24T09:16:00Z',
              },
            ],
            totalElements: 1,
            totalPages: 1,
            number: 0,
            size: 20,
          });
        }

        return successEnvelope({
          content: [
            {
              auditId: 'log-0',
              memberUuid: 'member-001',
              email: 'member-001@example.com',
              eventType: 'LOGIN_SUCCESS',
              ipAddress: '127.0.0.1',
              userAgent: 'playwright',
              description: 'baseline audit row',
              clOrdId: null,
              orderSessionId: null,
              createdAt: '2026-03-24T09:10:00Z',
            },
          ],
          totalElements: 1,
          totalPages: 1,
          number: 0,
          size: 20,
        });
      }

      if (
        request.method === 'DELETE'
        && getPathname(request.url) === '/api/v1/admin/members/member-001/sessions'
      ) {
        return successEnvelope({
          memberUuid: 'member-001',
          invalidatedCount: 1,
          message: '세션이 무효화되었습니다.',
        });
      }

      throw new Error(`Unhandled request: ${request.method} ${request.url}`);
    });

    const { AdminConsolePage } = await import('@/pages/AdminConsolePage');
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={['/admin']}>
        <AdminConsolePage />
      </MemoryRouter>,
    );

    expect(await screen.findByTestId('admin-audit-row-log-0')).toBeInTheDocument();
    expect(screen.getByTestId('admin-monitoring-card-executionVolume')).toBeInTheDocument();

    await user.type(screen.getByTestId('admin-force-member-uuid'), 'member-001');
    await user.click(screen.getByTestId('admin-force-submit'));

    expect(await screen.findByTestId('admin-force-feedback')).toHaveTextContent(
      '세션이 무효화되었습니다. (무효화된 세션: 1건)',
    );

    await user.click(screen.getByTestId('admin-monitoring-audit-executionVolume'));

    expect(await screen.findByTestId('admin-audit-row-log-order-execute')).toBeInTheDocument();
    expect(
      calls.some(
        (call) =>
          call.method === 'GET'
          && getPathname(call.url) === '/api/v1/admin/audit-logs'
          && new URL(call.url, 'http://localhost').searchParams.get('eventType') === 'ORDER_EXECUTE',
      ),
    ).toBe(true);
  });
});
