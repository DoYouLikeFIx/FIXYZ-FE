import { parseAdminMonitoringPanelsConfig } from '@/types/adminMonitoring';

const createValidMonitoringPanelsConfig = () =>
  JSON.stringify([
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
        statusMessage: 'Live',
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
        statusMessage: 'Stale',
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
        lastUpdatedLabel: 'Last updated',
        companionPanelUrl: 'https://grafana.fix.local/d/ops/market-data?viewPanel=31',
        status: 'unavailable',
        statusMessage: 'Unavailable',
        lastUpdatedAt: '2026-03-24T08:52:00Z',
      },
      drillDown: {
        grafanaUrl: 'https://grafana.fix.local/d/ops/market-data?viewPanel=13',
      },
    },
  ]);

describe('parseAdminMonitoringPanelsConfig', () => {
  it('accepts a complete safe monitoring panel configuration', () => {
    const result = parseAdminMonitoringPanelsConfig(createValidMonitoringPanelsConfig());

    expect(result.status).toBe('ready');

    if (result.status === 'ready') {
      expect(result.panelsByKey.executionVolume.freshness.status).toBe('live');
      expect(result.panelsByKey.executionVolume.drillDown.adminAuditUrl).toBe(
        '/admin?auditEventType=ORDER_EXECUTE',
      );
    }
  });

  it('rejects configs that omit required freshness status and timestamp', () => {
    const panels = JSON.parse(createValidMonitoringPanelsConfig()) as Array<Record<string, unknown>>;
    panels[0] = {
      ...panels[0],
      freshness: {
        ...(panels[0].freshness as Record<string, unknown>),
        status: undefined,
        lastUpdatedAt: undefined,
      },
    };

    const result = parseAdminMonitoringPanelsConfig(JSON.stringify(panels));

    expect(result).toMatchObject({
      status: 'invalid',
      message: expect.stringContaining('불완전'),
    });
  });

  it('rejects configs with unsafe or malformed monitoring urls', () => {
    const unsafePanels = JSON.parse(createValidMonitoringPanelsConfig()) as Array<Record<string, unknown>>;
    unsafePanels[0] = {
      ...unsafePanels[0],
      linkUrl: 'javascript:alert(1)',
    };

    expect(parseAdminMonitoringPanelsConfig(JSON.stringify(unsafePanels))).toMatchObject({
      status: 'invalid',
      message: expect.stringContaining('불완전'),
    });

    const invalidAuditPanels = JSON.parse(createValidMonitoringPanelsConfig()) as Array<Record<string, unknown>>;
    invalidAuditPanels[0] = {
      ...invalidAuditPanels[0],
      drillDown: {
        ...(invalidAuditPanels[0].drillDown as Record<string, unknown>),
        adminAuditUrl: '/admin?auditEventType=NOT_A_REAL_EVENT',
      },
    };

    expect(parseAdminMonitoringPanelsConfig(JSON.stringify(invalidAuditPanels))).toMatchObject({
      status: 'invalid',
      message: expect.stringContaining('불완전'),
    });

    const unsupportedQueryPanels = JSON.parse(createValidMonitoringPanelsConfig()) as Array<Record<string, unknown>>;
    unsupportedQueryPanels[0] = {
      ...unsupportedQueryPanels[0],
      drillDown: {
        ...(unsupportedQueryPanels[0].drillDown as Record<string, unknown>),
        adminAuditUrl: '/admin?auditEventType=ORDER_EXECUTE&memberId=member-001',
      },
    };

    expect(parseAdminMonitoringPanelsConfig(JSON.stringify(unsupportedQueryPanels))).toMatchObject({
      status: 'invalid',
      message: expect.stringContaining('불완전'),
    });
  });
});
