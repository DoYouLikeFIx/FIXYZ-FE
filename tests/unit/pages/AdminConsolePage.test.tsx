import { act } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, MemoryRouter, RouterProvider } from 'react-router-dom';

import { fetchAdminAuditLogs, invalidateMemberSessions } from '@/api/adminApi';
import { AdminConsolePage } from '@/pages/AdminConsolePage';
import { resetAuthStore } from '@/store/useAuthStore';
import type { AdminAuditLog, AdminAuditLogsPage } from '@/types/admin';

vi.mock('@/api/adminApi', () => ({
  fetchAdminAuditLogs: vi.fn(),
  invalidateMemberSessions: vi.fn(),
}));

const createAuditLog = (id: string): AdminAuditLog => ({
  auditId: id,
  memberUuid: 'member-001',
  email: 'member-001@example.com',
  eventType: 'LOGIN_SUCCESS',
  ipAddress: '127.0.0.1',
  userAgent: 'playwright',
  description: `event-${id}`,
  clOrdId: null,
  orderSessionId: null,
  createdAt: '2026-03-18T09:00:00Z',
});

const createAuditPage = (contentId: string, totalPages = 1): AdminAuditLogsPage => ({
  content: [createAuditLog(contentId)],
  totalElements: 1,
  totalPages,
  number: 0,
  size: 20,
});

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

describe('AdminConsolePage', () => {
  const renderPage = (initialEntries: string[] = ['/admin']) =>
    render(
      <MemoryRouter initialEntries={initialEntries}>
        <AdminConsolePage />
      </MemoryRouter>,
    );

  beforeEach(() => {
    resetAuthStore();
    vi.stubEnv('VITE_ADMIN_MONITORING_PANELS_JSON', monitoringPanelsConfig);
    vi.mocked(fetchAdminAuditLogs).mockReset();
    vi.mocked(invalidateMemberSessions).mockReset();
    vi.mocked(fetchAdminAuditLogs).mockResolvedValue(createAuditPage('log-0', 1));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('shows the force-logout and audit-search entry points for admin users', async () => {
    renderPage();

    expect(screen.getByTestId('admin-force-member-uuid')).toBeInTheDocument();
    expect(screen.getByTestId('admin-audit-search')).toBeInTheDocument();
    expect(screen.getByTestId('admin-monitoring-card-executionVolume')).toBeInTheDocument();
    expect(await screen.findByTestId('admin-audit-row-log-0')).toBeInTheDocument();
  });

  it('renders configured monitoring panels with freshness states and drill-down links', async () => {
    renderPage();

    expect(await screen.findByTestId('admin-audit-row-log-0')).toBeInTheDocument();

    expect(screen.getByTestId('admin-monitoring-status-executionVolume')).toHaveTextContent('실시간 scrape 정상');
    expect(screen.getByTestId('admin-monitoring-last-updated-pendingSessions')).toHaveTextContent('마지막 갱신');
    expect(screen.getByTestId('admin-monitoring-open-executionVolume')).toHaveAttribute(
      'href',
      'https://grafana.fix.local/d/ops/exec-volume',
    );
    expect(screen.getByTestId('admin-monitoring-drilldown-pendingSessions')).toHaveAttribute(
      'href',
      'https://grafana.fix.local/d/ops/pending-sessions?viewPanel=12',
    );
    expect(screen.getByTestId('admin-monitoring-embed-marketDataIngest')).toHaveAttribute(
      'src',
      'https://grafana.fix.local/d-solo/ops/market-data?panelId=13',
    );
    expect(screen.getByTestId('admin-monitoring-freshness-marketDataIngest')).toHaveAttribute(
      'href',
      'https://grafana.fix.local/d/ops/market-data?viewPanel=31',
    );
  });

  it('shows deterministic guidance when monitoring config is missing', async () => {
    vi.unstubAllEnvs();

    renderPage();

    expect(screen.getByTestId('admin-monitoring-config-message')).toHaveTextContent(
      '운영 모니터링 패널이 아직 구성되지 않았습니다.',
    );
    expect(screen.getByTestId('admin-monitoring-guidance-executionVolume')).toBeInTheDocument();
    expect(await screen.findByTestId('admin-audit-row-log-0')).toBeInTheDocument();
  });

  it('shows successful feedback for force-logout with invalidatedCount=0', async () => {
    const user = userEvent.setup();
    vi.mocked(invalidateMemberSessions).mockResolvedValue({
      memberUuid: 'member-001',
      invalidatedCount: 0,
      message: '이미 비활성 세션 상태입니다.',
    });

    renderPage();

    await user.type(screen.getByTestId('admin-force-member-uuid'), 'member-001');
    await user.click(screen.getByTestId('admin-force-submit'));

    expect(await screen.findByTestId('admin-force-feedback')).toHaveTextContent(
      '이미 비활성 세션 상태입니다. (무효화된 세션: 0건)',
    );
  });

  it('shows failure feedback for force-logout API errors', async () => {
    const user = userEvent.setup();
    vi.mocked(invalidateMemberSessions).mockRejectedValue(
      Object.assign(new Error('forbidden'), {
        code: 'AUTH-006',
      }),
    );

    renderPage();

    await user.type(screen.getByTestId('admin-force-member-uuid'), 'member-001');
    await user.click(screen.getByTestId('admin-force-submit'));

    expect(await screen.findByTestId('admin-force-feedback')).not.toHaveTextContent('0건');
  });

  it('applies audit filters and page navigation to the query contract', async () => {
    const user = userEvent.setup();
    const expectedFrom = new Date('2026-03-18T00:00').toISOString();
    const expectedTo = new Date('2026-03-18T23:59').toISOString();
    vi.mocked(fetchAdminAuditLogs)
      .mockResolvedValueOnce(createAuditPage('log-0', 1))
      .mockResolvedValueOnce({
        content: [
          {
            ...createAuditLog('log-1'),
            eventType: 'LOGIN_FAIL',
          },
        ],
        totalElements: 2,
        totalPages: 2,
        number: 0,
        size: 20,
      })
      .mockResolvedValueOnce({
        ...createAuditPage('log-2', 2),
        number: 1,
      });

    renderPage();

    expect(await screen.findByTestId('admin-audit-row-log-0')).toBeInTheDocument();

    await user.type(screen.getByTestId('admin-audit-member-id'), 'member-001');
    await user.type(screen.getByTestId('admin-audit-from'), '2026-03-18T00:00');
    await user.type(screen.getByTestId('admin-audit-to'), '2026-03-18T23:59');
    await user.selectOptions(screen.getByTestId('admin-audit-event-type'), 'LOGIN_FAIL');
    await user.click(screen.getByTestId('admin-audit-search'));

    expect(await screen.findByTestId('admin-audit-row-log-1')).toBeInTheDocument();
    expect(vi.mocked(fetchAdminAuditLogs).mock.calls[1]).toEqual([
      {
        page: 0,
        size: 20,
        memberId: 'member-001',
        from: expectedFrom,
        to: expectedTo,
        eventType: 'LOGIN_FAIL',
      },
      expect.any(AbortSignal),
    ]);

    await user.click(screen.getByTestId('admin-audit-next'));
    expect(await screen.findByTestId('admin-audit-row-log-2')).toBeInTheDocument();
    expect(screen.getByTestId('admin-audit-page-indicator')).toHaveTextContent('2 / 2');

    expect(vi.mocked(fetchAdminAuditLogs).mock.calls[2]).toEqual([
      {
        page: 1,
        size: 20,
        memberId: 'member-001',
        from: expectedFrom,
        to: expectedTo,
        eventType: 'LOGIN_FAIL',
      },
      expect.any(AbortSignal),
    ]);

    await waitFor(() => {
      expect(vi.mocked(fetchAdminAuditLogs)).toHaveBeenCalledTimes(3);
    });
  });

  it('displays an error message when audit log fetch fails', async () => {
    vi.mocked(fetchAdminAuditLogs).mockRejectedValueOnce(
      Object.assign(new Error('service unavailable'), {
        code: 'ERR_NETWORK',
      }),
    );

    renderPage();

    expect(await screen.findByTestId('admin-audit-error')).toBeInTheDocument();
  });

  it('keeps the requested page even when API returns a different page number', async () => {
    const user = userEvent.setup();
    let resolveSecondRequest: (value: AdminAuditLogsPage) => void;

    vi.mocked(fetchAdminAuditLogs)
      .mockResolvedValueOnce(createAuditPage('log-0', 2))
      .mockImplementationOnce(
        () =>
          new Promise<AdminAuditLogsPage>((resolve) => {
            resolveSecondRequest = resolve;
          }),
      );

    renderPage();

    expect(await screen.findByTestId('admin-audit-row-log-0')).toBeInTheDocument();

    await user.click(screen.getByTestId('admin-audit-next'));

    await waitFor(() => {
      expect(vi.mocked(fetchAdminAuditLogs)).toHaveBeenCalledTimes(2);
    });

    await act(async () => {
      resolveSecondRequest({
        ...createAuditPage('log-1', 2),
        number: 0,
      });
    });

    expect(await screen.findByTestId('admin-audit-row-log-1')).toBeInTheDocument();
    expect(screen.getByTestId('admin-audit-page-indicator')).toHaveTextContent('2 / 2');
    expect(vi.mocked(fetchAdminAuditLogs).mock.calls[1]).toEqual([
      {
        page: 1,
        size: 20,
        memberId: undefined,
        from: undefined,
        to: undefined,
        eventType: undefined,
      },
      expect.any(AbortSignal),
    ]);
  });

  it('does not show stale audit error when a newer request succeeds', async () => {
    const user = userEvent.setup();
    let rejectFirstRequest: (error?: unknown) => void;
    let resolveSecondRequest: (value: AdminAuditLogsPage) => void;

    vi.mocked(fetchAdminAuditLogs)
      .mockImplementationOnce(
        () =>
          new Promise<AdminAuditLogsPage>((_, reject) => {
            rejectFirstRequest = reject;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<AdminAuditLogsPage>((resolve) => {
            resolveSecondRequest = resolve;
          }),
      );

    renderPage();

    await user.type(screen.getByTestId('admin-audit-member-id'), 'member-001');
    await user.click(screen.getByTestId('admin-audit-search'));

    await waitFor(() => {
      expect(vi.mocked(fetchAdminAuditLogs)).toHaveBeenCalledTimes(2);
    });

    await act(async () => {
      resolveSecondRequest(createAuditPage('log-1', 1));
    });

    expect(await screen.findByTestId('admin-audit-row-log-1')).toBeInTheDocument();

    await act(async () => {
      rejectFirstRequest(new Error('stale failure'));
    });

    expect(screen.queryByTestId('admin-audit-error')).not.toBeInTheDocument();
  });

  it('keeps the latest audit logs when older responses arrive late', async () => {
    const user = userEvent.setup();
    let resolveFirstRequest!: (value: AdminAuditLogsPage) => void;
    let resolveSecondRequest!: (value: AdminAuditLogsPage) => void;

    vi.mocked(fetchAdminAuditLogs)
      .mockImplementationOnce(
        () =>
          new Promise<AdminAuditLogsPage>((resolve) => {
            resolveFirstRequest = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<AdminAuditLogsPage>((resolve) => {
            resolveSecondRequest = resolve;
          }),
      )
      .mockResolvedValue(createAuditPage('ignored'));

    renderPage();

    await user.type(screen.getByTestId('admin-audit-member-id'), 'member-new');
    await user.click(screen.getByTestId('admin-audit-search'));

    await waitFor(() => {
      expect(vi.mocked(fetchAdminAuditLogs)).toHaveBeenCalledTimes(2);
    });

    await act(async () => {
      resolveSecondRequest({
        ...createAuditPage('newest-log', 1),
        number: 0,
      });
    });

    expect(await screen.findByTestId('admin-audit-row-newest-log')).toBeInTheDocument();

    await act(async () => {
      resolveFirstRequest(createAuditPage('stale-log'));
    });

    await waitFor(() => {
      expect(screen.queryByTestId('admin-audit-row-stale-log')).not.toBeInTheDocument();
    });
  });

  it('disables page size controls while audit logs are loading', async () => {
    const user = userEvent.setup();
    let resolveRequest!: (value: AdminAuditLogsPage) => void;
    vi.mocked(fetchAdminAuditLogs).mockImplementation(
      () =>
        new Promise<AdminAuditLogsPage>((resolve) => {
          resolveRequest = resolve;
        }),
    );

    renderPage();

    const sizeButton = await screen.findByTestId('admin-audit-size-50');

    await waitFor(() => {
      expect(sizeButton).toBeDisabled();
    });

    await user.click(sizeButton);

    expect(vi.mocked(fetchAdminAuditLogs)).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveRequest(createAuditPage('log-50'));
    });
  });

  it('applies monitoring audit drill-down to the existing audit query contract', async () => {
    const user = userEvent.setup();
    vi.mocked(fetchAdminAuditLogs)
      .mockResolvedValueOnce(createAuditPage('log-0', 1))
      .mockResolvedValueOnce({
        content: [
          {
            ...createAuditLog('log-order-execute'),
            eventType: 'ORDER_EXECUTE',
          },
        ],
        totalElements: 1,
        totalPages: 1,
        number: 0,
        size: 20,
      });

    renderPage();

    expect(await screen.findByTestId('admin-audit-row-log-0')).toBeInTheDocument();

    await user.click(screen.getByTestId('admin-monitoring-audit-executionVolume'));

    expect(await screen.findByTestId('admin-audit-row-log-order-execute')).toBeInTheDocument();
    expect(screen.getByTestId('admin-audit-event-type')).toHaveValue('ORDER_EXECUTE');
    expect(vi.mocked(fetchAdminAuditLogs).mock.calls[1]).toEqual([
      {
        page: 0,
        size: 20,
        memberId: undefined,
        from: undefined,
        to: undefined,
        eventType: 'ORDER_EXECUTE',
      },
      expect.any(AbortSignal),
    ]);
  });

  it('prefers the descriptor audit target over the panel-key fallback when drill-down is clicked', async () => {
    const user = userEvent.setup();
    const overriddenPanels = JSON.parse(monitoringPanelsConfig) as Array<Record<string, unknown>>;
    overriddenPanels[0] = {
      ...overriddenPanels[0],
      drillDown: {
        ...(overriddenPanels[0].drillDown as Record<string, unknown>),
        adminAuditUrl: '/admin?auditEventType=ORDER_SESSION_CREATE',
      },
    };

    vi.stubEnv('VITE_ADMIN_MONITORING_PANELS_JSON', JSON.stringify(overriddenPanels));
    vi.mocked(fetchAdminAuditLogs)
      .mockResolvedValueOnce(createAuditPage('log-0', 1))
      .mockResolvedValueOnce({
        content: [
          {
            ...createAuditLog('log-order-session-create'),
            eventType: 'ORDER_SESSION_CREATE',
          },
        ],
        totalElements: 1,
        totalPages: 1,
        number: 0,
        size: 20,
      });

    renderPage();

    expect(await screen.findByTestId('admin-audit-row-log-0')).toBeInTheDocument();

    await user.click(screen.getByTestId('admin-monitoring-audit-executionVolume'));

    expect(await screen.findByTestId('admin-audit-row-log-order-session-create')).toBeInTheDocument();
    expect(screen.getByTestId('admin-audit-event-type')).toHaveValue('ORDER_SESSION_CREATE');
    expect(vi.mocked(fetchAdminAuditLogs).mock.calls[1]).toEqual([
      {
        page: 0,
        size: 20,
        memberId: undefined,
        from: undefined,
        to: undefined,
        eventType: 'ORDER_SESSION_CREATE',
      },
      expect.any(AbortSignal),
    ]);
  });

  it('hydrates the audit filter from the admin monitoring query param', async () => {
    vi.mocked(fetchAdminAuditLogs).mockResolvedValueOnce({
      content: [
        {
          ...createAuditLog('log-query-param'),
          eventType: 'ORDER_EXECUTE',
        },
      ],
      totalElements: 1,
      totalPages: 1,
      number: 0,
      size: 20,
    });

    renderPage(['/admin?auditEventType=ORDER_EXECUTE']);

    expect(await screen.findByTestId('admin-audit-row-log-query-param')).toBeInTheDocument();
    expect(screen.getByTestId('admin-audit-event-type')).toHaveValue('ORDER_EXECUTE');
    expect(vi.mocked(fetchAdminAuditLogs).mock.calls[0]).toEqual([
      {
        page: 0,
        size: 20,
        memberId: undefined,
        from: undefined,
        to: undefined,
        eventType: 'ORDER_EXECUTE',
      },
      expect.any(AbortSignal),
    ]);
  });

  it('clears the audit shortcut filter when back navigation removes the query param', async () => {
    const router = createMemoryRouter(
      [{
        path: '/admin',
        element: <AdminConsolePage />,
      }],
      {
        initialEntries: ['/admin?auditEventType=ORDER_EXECUTE'],
      },
    );

    vi.mocked(fetchAdminAuditLogs)
      .mockResolvedValueOnce({
        content: [
          {
            ...createAuditLog('log-query-param'),
            eventType: 'ORDER_EXECUTE',
          },
        ],
        totalElements: 1,
        totalPages: 1,
        number: 0,
        size: 20,
      })
      .mockResolvedValueOnce(createAuditPage('log-back-nav', 1));

    render(<RouterProvider router={router} />);

    expect(await screen.findByTestId('admin-audit-row-log-query-param')).toBeInTheDocument();
    expect(screen.getByTestId('admin-audit-event-type')).toHaveValue('ORDER_EXECUTE');

    await act(async () => {
      await router.navigate('/admin');
    });

    await waitFor(() => {
      expect(vi.mocked(fetchAdminAuditLogs)).toHaveBeenCalledTimes(2);
    });
    expect(await screen.findByTestId('admin-audit-row-log-back-nav')).toBeInTheDocument();
    expect(screen.getByTestId('admin-audit-event-type')).toHaveValue('');
    expect(vi.mocked(fetchAdminAuditLogs).mock.calls[1]).toEqual([
      {
        page: 0,
        size: 20,
        memberId: undefined,
        from: undefined,
        to: undefined,
        eventType: undefined,
      },
      expect.any(AbortSignal),
    ]);
  });
});
