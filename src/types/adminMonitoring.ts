import { z } from 'zod';

import { ADMIN_AUDIT_EVENT_TYPE_QUERY_KEY, ADMIN_ROUTE } from '@/router/navigation';
import { isAdminAuditEventType } from '@/types/admin';

export const ADMIN_MONITORING_PANEL_KEYS = [
  'executionVolume',
  'pendingSessions',
  'marketDataIngest',
] as const;

export type AdminMonitoringPanelKey = (typeof ADMIN_MONITORING_PANEL_KEYS)[number];

export type AdminMonitoringPanelFreshnessStatus = 'live' | 'stale' | 'unavailable';

export interface AdminMonitoringPanelFreshness {
  source: 'grafana-panel' | 'grafana-companion-panel';
  indicatorLabel: string;
  lastUpdatedLabel: string;
  companionPanelUrl?: string;
  status: AdminMonitoringPanelFreshnessStatus;
  statusMessage?: string;
  lastUpdatedAt: string;
}

export interface AdminMonitoringPanelDescriptor {
  key: AdminMonitoringPanelKey;
  title: string;
  description: string;
  mode: 'link' | 'embed';
  linkUrl: string;
  embedUrl?: string;
  dashboardUid: string;
  panelId: number;
  sourceMetricHint: string;
  freshness: AdminMonitoringPanelFreshness;
  drillDown: {
    grafanaUrl: string;
    adminAuditUrl?: string;
  };
}

export type AdminMonitoringPanelsByKey = Record<AdminMonitoringPanelKey, AdminMonitoringPanelDescriptor>;

export type AdminMonitoringPanelsConfigResult =
  | {
      status: 'ready';
      panels: AdminMonitoringPanelDescriptor[];
      panelsByKey: AdminMonitoringPanelsByKey;
    }
  | {
      status: 'missing' | 'invalid';
      message: string;
    };

const isSafeExternalUrl = (value: string) => {
  try {
    const parsed = new URL(value);

    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
};

const isValidTimestamp = (value: string) => !Number.isNaN(Date.parse(value));

const isSafeAdminAuditUrl = (value: string) => {
  try {
    const parsed = new URL(value, 'http://localhost');

    if (parsed.origin !== 'http://localhost' || parsed.pathname !== ADMIN_ROUTE) {
      return false;
    }

    const queryKeys = Array.from(parsed.searchParams.keys());

    if (queryKeys.some((key) => key !== ADMIN_AUDIT_EVENT_TYPE_QUERY_KEY)) {
      return false;
    }

    const eventTypes = parsed.searchParams.getAll(ADMIN_AUDIT_EVENT_TYPE_QUERY_KEY);

    if (eventTypes.length > 1) {
      return false;
    }

    const [eventType] = eventTypes;

    return eventType === undefined || isAdminAuditEventType(eventType);
  } catch {
    return false;
  }
};

const externalUrlSchema = z.string().trim().min(1).refine(isSafeExternalUrl, {
  message: 'Monitoring URLs must use an absolute http(s) URL.',
});

const timestampSchema = z.string().trim().min(1).refine(isValidTimestamp, {
  message: 'Freshness timestamps must be a valid date-time string.',
});

const adminAuditUrlSchema = z.string().trim().min(1).refine(isSafeAdminAuditUrl, {
  message: 'adminAuditUrl must target /admin with an optional valid auditEventType query.',
}).optional();

const descriptorSchema: z.ZodType<AdminMonitoringPanelDescriptor> = z.object({
  key: z.enum(ADMIN_MONITORING_PANEL_KEYS),
  title: z.string().trim().min(1),
  description: z.string().trim().min(1),
  mode: z.enum(['link', 'embed']),
  linkUrl: externalUrlSchema,
  embedUrl: externalUrlSchema.optional(),
  dashboardUid: z.string().trim().min(1),
  panelId: z.number().int().positive(),
  sourceMetricHint: z.string().trim().min(1),
  freshness: z.object({
    source: z.enum(['grafana-panel', 'grafana-companion-panel']),
    indicatorLabel: z.string().trim().min(1),
    lastUpdatedLabel: z.string().trim().min(1),
    companionPanelUrl: externalUrlSchema.optional(),
    status: z.enum(['live', 'stale', 'unavailable']),
    statusMessage: z.string().trim().min(1).optional(),
    lastUpdatedAt: timestampSchema,
  }).superRefine((freshness, ctx) => {
    if (freshness.source === 'grafana-companion-panel' && !freshness.companionPanelUrl) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'grafana-companion-panel freshness sources require companionPanelUrl.',
      });
    }
  }),
  drillDown: z.object({
    grafanaUrl: externalUrlSchema,
    adminAuditUrl: adminAuditUrlSchema,
  }),
}).superRefine((descriptor, ctx) => {
  if (descriptor.mode === 'embed' && !descriptor.embedUrl) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'embed mode requires embedUrl.',
      path: ['embedUrl'],
    });
  }
});

const configSchema = z.array(descriptorSchema).superRefine((descriptors, ctx) => {
  const seenKeys = new Set<AdminMonitoringPanelKey>();

  descriptors.forEach((descriptor, index) => {
    if (seenKeys.has(descriptor.key)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Duplicate monitoring panel key: ${descriptor.key}`,
        path: [index, 'key'],
      });
      return;
    }

    seenKeys.add(descriptor.key);
  });

  ADMIN_MONITORING_PANEL_KEYS.forEach((key) => {
    if (!seenKeys.has(key)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Missing monitoring panel descriptor for key: ${key}`,
      });
    }
  });
});

export const parseAdminMonitoringPanelsConfig = (
  rawConfig: string | undefined,
): AdminMonitoringPanelsConfigResult => {
  const normalized = rawConfig?.trim();

  if (!normalized) {
    return {
      status: 'missing',
      message:
        '운영 모니터링 패널이 아직 구성되지 않았습니다. `VITE_ADMIN_MONITORING_PANELS_JSON`을 설정해 주세요.',
    };
  }

  let parsedJson: unknown;

  try {
    parsedJson = JSON.parse(normalized);
  } catch {
    return {
      status: 'invalid',
      message:
        '운영 모니터링 패널 구성을 읽지 못했습니다. `VITE_ADMIN_MONITORING_PANELS_JSON` JSON 형식을 확인해 주세요.',
    };
  }

  const parsedConfig = configSchema.safeParse(parsedJson);

  if (!parsedConfig.success) {
    return {
      status: 'invalid',
      message:
        '운영 모니터링 패널 구성이 불완전합니다. 필수 panel descriptor와 freshness/drill-down 필드를 확인해 주세요.',
    };
  }

  const panelsByKey = parsedConfig.data.reduce<Partial<AdminMonitoringPanelsByKey>>((acc, descriptor) => {
    acc[descriptor.key] = descriptor;
    return acc;
  }, {});

  return {
    status: 'ready',
    panels: ADMIN_MONITORING_PANEL_KEYS.map((key) => panelsByKey[key] as AdminMonitoringPanelDescriptor),
    panelsByKey: panelsByKey as AdminMonitoringPanelsByKey,
  };
};
