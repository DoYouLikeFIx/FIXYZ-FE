import { isAxiosError } from 'axios';
import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { fetchAdminAuditLogs, invalidateMemberSessions } from '@/api/adminApi';
import { getAuthErrorMessage } from '@/lib/auth-errors';
import {
  ADMIN_AUDIT_EVENT_TYPE_QUERY_KEY,
  buildAdminAuditPath,
} from '@/router/navigation';
import {
  ADMIN_AUDIT_EVENT_TYPES,
  type AdminAuditEventType,
  type AdminAuditLog,
  type AdminAuditLogQuery,
  isAdminAuditEventType,
} from '@/types/admin';
import {
  ADMIN_MONITORING_PANEL_KEYS,
  type AdminMonitoringPanelDescriptor,
  type AdminMonitoringPanelKey,
  parseAdminMonitoringPanelsConfig,
} from '@/types/adminMonitoring';

const AUDIT_PAGE_SIZE_OPTIONS = [20, 50, 100] as const;

const ADMIN_MONITORING_CARD_COPY: Record<AdminMonitoringPanelKey, {
  title: string;
  description: string;
}> = {
  executionVolume: {
    title: '체결 처리량',
    description: '주문 실행량과 처리 흐름을 Grafana 패널로 확인합니다.',
  },
  pendingSessions: {
    title: '대기 세션',
    description: '재조회 또는 운영자 개입이 필요한 세션 흐름을 점검합니다.',
  },
  marketDataIngest: {
    title: '시세 수집 상태',
    description: '시장 데이터 ingest와 연결 상태를 한눈에 확인합니다.',
  },
};

const ADMIN_MONITORING_AUDIT_SHORTCUTS: Partial<Record<AdminMonitoringPanelKey, AdminAuditEventType>> = {
  executionVolume: 'ORDER_EXECUTE',
  pendingSessions: 'ORDER_SESSION_CREATE',
};

type FeedbackTone = 'info' | 'error';

interface AuditErrorState {
  message: string;
}

interface FeedbackState {
  tone: FeedbackTone;
  message: string;
}

interface DateTimeParseResult {
  value: string | undefined;
  isValid: boolean;
}

const normalizeFilter = (value: string) => value.trim() || undefined;

const normalizeDateTimeFilter = (value: string): DateTimeParseResult => {
  const trimmed = value.trim();

  if (!trimmed) {
    return { value: undefined, isValid: true };
  }

  const parsed = new Date(trimmed);

  if (Number.isNaN(parsed.getTime())) {
    return { value: undefined, isValid: false };
  }

  return { value: parsed.toISOString(), isValid: true };
};

const extractErrorCode = (error: unknown) =>
  typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code)
    : undefined;

const normalizeRetryAfter = (error: unknown) =>
  typeof error === 'object' && error !== null && 'retryAfterSeconds' in error
    ? Number((error as { retryAfterSeconds?: unknown }).retryAfterSeconds)
    : undefined;

const getAuditErrorMessage = (error: unknown) => {
  const message = getAuthErrorMessage(error);
  const code = extractErrorCode(error)?.replace(/_/g, '-');
  const retryAfterSeconds = normalizeRetryAfter(error);

  if (code === 'VALIDATION-001') {
    return `${message}. 시작 시각과 종료 시각 범위를 다시 확인해 주세요.`;
  }

  if (code === 'RATE-001' && Number.isFinite(retryAfterSeconds)) {
    return `${message} (약 ${retryAfterSeconds}초 뒤에 다시 시도해 주세요.)`;
  }

  if (code === 'AUTH-006') {
    return `${message}. 관리자 권한이 필요한 요청입니다.`;
  }

  return message;
};

const isMemberUuidInputInvalid = (memberUuid: string) =>
  memberUuid.length === 0 || memberUuid.length > 128;

const formatAuditTime = (value: string) => {
  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat('ko-KR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(parsed);
};

const formatMonitoringTime = (value: string | undefined) => {
  if (!value) {
    return undefined;
  }

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat('ko-KR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(parsed);
};

const resolveAuditShortcutEventType = (value: string | null) =>
  isAdminAuditEventType(value)
    ? value
    : undefined;

const getMonitoringStatusText = (descriptor: AdminMonitoringPanelDescriptor) =>
  descriptor.freshness.statusMessage ?? descriptor.freshness.indicatorLabel;

const getMonitoringLastUpdatedText = (descriptor: AdminMonitoringPanelDescriptor) => {
  const formatted = formatMonitoringTime(descriptor.freshness.lastUpdatedAt);

  return formatted
    ? `${descriptor.freshness.lastUpdatedLabel}: ${formatted}`
    : descriptor.freshness.lastUpdatedLabel;
};

export function AdminConsolePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const monitoringConfig = useMemo(
    () => parseAdminMonitoringPanelsConfig(import.meta.env.VITE_ADMIN_MONITORING_PANELS_JSON),
    [],
  );
  const monitoringConfigMessage = monitoringConfig.status === 'ready'
    ? null
    : monitoringConfig.message;
  const auditShortcutEventType = resolveAuditShortcutEventType(
    searchParams.get(ADMIN_AUDIT_EVENT_TYPE_QUERY_KEY),
  );
  const auditSectionRef = useRef<HTMLElement | null>(null);
  const [memberUuid, setMemberUuid] = useState('');
  const [forceLogoutFeedback, setForceLogoutFeedback] = useState<FeedbackState | null>(null);
  const [isForceLogoutSubmitting, setIsForceLogoutSubmitting] = useState(false);

  const [memberIdFilter, setMemberIdFilter] = useState('');
  const [fromFilter, setFromFilter] = useState('');
  const [toFilter, setToFilter] = useState('');
  const [eventTypeFilter, setEventTypeFilter] = useState(auditShortcutEventType ?? '');
  const [appliedMemberIdFilter, setAppliedMemberIdFilter] = useState('');
  const [appliedFromFilter, setAppliedFromFilter] = useState('');
  const [appliedToFilter, setAppliedToFilter] = useState('');
  const [appliedEventTypeFilter, setAppliedEventTypeFilter] = useState(auditShortcutEventType ?? '');

  const [auditPage, setAuditPage] = useState(0);
  const [auditSize, setAuditSize] = useState<(typeof AUDIT_PAGE_SIZE_OPTIONS)[number]>(
    AUDIT_PAGE_SIZE_OPTIONS[0],
  );
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState<AuditErrorState | null>(null);
  const [auditItems, setAuditItems] = useState<AdminAuditLog[]>([]);
  const [auditTotalElements, setAuditTotalElements] = useState(0);
  const [auditTotalPages, setAuditTotalPages] = useState(0);
  const latestAuditLogRequestIdRef = useRef(0);
  const latestAuditLogAbortControllerRef = useRef<AbortController | null>(null);

  const currentAuditQuery = useMemo<AdminAuditLogQuery>(() => ({
    page: auditPage,
    size: auditSize,
    memberId: normalizeFilter(appliedMemberIdFilter),
    from: normalizeFilter(appliedFromFilter),
    to: normalizeFilter(appliedToFilter),
    eventType: appliedEventTypeFilter
      ? (appliedEventTypeFilter as AdminAuditEventType)
      : undefined,
  }), [
    auditPage,
    auditSize,
    appliedEventTypeFilter,
    appliedFromFilter,
    appliedMemberIdFilter,
    appliedToFilter,
  ]);

  const loadAuditLogs = async (query: AdminAuditLogQuery) => {
    const requestId = ++latestAuditLogRequestIdRef.current;
    latestAuditLogAbortControllerRef.current?.abort();
    const abortController = new AbortController();
    latestAuditLogAbortControllerRef.current = abortController;
    setAuditLoading(true);
    setAuditError(null);
    const nextPage = query.page ?? 0;

    try {
      const pageData = await fetchAdminAuditLogs(query, abortController.signal);
      if (latestAuditLogRequestIdRef.current !== requestId) {
        return;
      }

      setAuditItems(pageData.content);
      setAuditTotalElements(pageData.totalElements);
      setAuditTotalPages(pageData.totalPages);
      setAuditPage(nextPage);
    } catch (error) {
      if (latestAuditLogRequestIdRef.current !== requestId) {
        return;
      }

      if (isAxiosError(error) && error.code === 'ERR_CANCELED') {
        return;
      }

      setAuditError({
        message: getAuditErrorMessage(error),
      });
    } finally {
      if (latestAuditLogRequestIdRef.current === requestId) {
        setAuditLoading(false);
      }
    }
  };

  useEffect(() => {
    void loadAuditLogs(currentAuditQuery);
  }, [currentAuditQuery]);

  useEffect(() => () => {
    latestAuditLogAbortControllerRef.current?.abort();
  }, []);

  useEffect(() => {
    if (!auditShortcutEventType) {
      return;
    }

    setAuditError(null);
    setAuditPage(0);
    setMemberIdFilter('');
    setFromFilter('');
    setToFilter('');
    setEventTypeFilter(auditShortcutEventType);
    setAppliedMemberIdFilter('');
    setAppliedFromFilter('');
    setAppliedToFilter('');
    setAppliedEventTypeFilter(auditShortcutEventType);
  }, [auditShortcutEventType]);

  const handleForceLogout = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const trimmedMemberUuid = memberUuid.trim();

    if (isMemberUuidInputInvalid(trimmedMemberUuid)) {
      setForceLogoutFeedback({
        tone: 'error',
        message:
          trimmedMemberUuid.length === 0
            ? 'memberUuid를 입력해 주세요.'
            : 'memberUuid가 너무 깁니다. (최대 128자)',
      });
      return;
    }

    setIsForceLogoutSubmitting(true);
    setForceLogoutFeedback(null);

    try {
      const response = await invalidateMemberSessions({
        memberUuid: trimmedMemberUuid,
      });

      setForceLogoutFeedback({
        tone: 'info',
        message: `${response.message} (무효화된 세션: ${response.invalidatedCount}건)`,
      });
    } catch (error) {
      setForceLogoutFeedback({
        tone: 'error',
        message: getAuthErrorMessage(error),
      });
    } finally {
      setIsForceLogoutSubmitting(false);
    }
  };

  const handleAuditSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const normalizedFrom = normalizeDateTimeFilter(fromFilter);
    const normalizedTo = normalizeDateTimeFilter(toFilter);

    if (fromFilter && !normalizedFrom.isValid) {
      setAuditError({
        message: '시작 시각(from)이 올바른 날짜/시간 형식이 아닙니다.',
      });

      return;
    }

    if (toFilter && !normalizedTo.isValid) {
      setAuditError({
        message: '종료 시각(to)이 올바른 날짜/시간 형식이 아닙니다.',
      });

      return;
    }

    if (
      normalizedFrom.value !== undefined
      && normalizedTo.value !== undefined
      && normalizedFrom.value > normalizedTo.value
    ) {
      setAuditError({
        message: '시작 시각(from)이 종료 시각(to)보다 늦습니다.',
      });

      return;
    }

    setAuditError(null);
    setAuditPage(0);
    setAppliedMemberIdFilter(memberIdFilter);
    setAppliedFromFilter(normalizedFrom.value ?? '');
    setAppliedToFilter(normalizedTo.value ?? '');
    setAppliedEventTypeFilter(eventTypeFilter);
  };

  const handleAuditPageSize = (nextSize: (typeof AUDIT_PAGE_SIZE_OPTIONS)[number]) => {
    if (auditSize === nextSize) {
      return;
    }

    setAuditSize(nextSize);
    setAuditPage(0);
  };

  const handleMonitoringAuditDrillDown = (panel: AdminMonitoringPanelDescriptor) => {
    const fallbackAuditEventType = ADMIN_MONITORING_AUDIT_SHORTCUTS[panel.key];
    const targetAuditUrl = panel.drillDown.adminAuditUrl?.trim()
      || (fallbackAuditEventType ? buildAdminAuditPath(fallbackAuditEventType) : '');

    if (!targetAuditUrl) {
      return;
    }

    const nextSearchParams = new URLSearchParams(new URL(targetAuditUrl, window.location.origin).search);
    const targetAuditEventType = resolveAuditShortcutEventType(
      nextSearchParams.get(ADMIN_AUDIT_EVENT_TYPE_QUERY_KEY),
    ) ?? fallbackAuditEventType;
    setSearchParams(nextSearchParams);

    setAuditError(null);
    setAuditPage(0);
    setMemberIdFilter('');
    setFromFilter('');
    setToFilter('');
    setEventTypeFilter(targetAuditEventType ?? '');
    setAppliedMemberIdFilter('');
    setAppliedFromFilter('');
    setAppliedToFilter('');
    setAppliedEventTypeFilter(targetAuditEventType ?? '');

    requestAnimationFrame(() => {
      if (typeof auditSectionRef.current?.scrollIntoView === 'function') {
        auditSectionRef.current.scrollIntoView({
          behavior: 'smooth',
          block: 'start',
        });
      }
    });
  };

  return (
    <section className="admin-console-shell">
      <header className="admin-console-hero">
        <p className="status-kicker">Admin security console</p>
        <h2 data-testid="admin-console-title">운영자 보안 및 모니터링 콘솔</h2>
        <p className="admin-console-hero__description">
          세션 무효화, 감사 로그 검색, 운영 관측 패널을 같은 `/admin` 화면에서 확인하세요.
        </p>
      </header>

      <section className="admin-console-grid">
        <article className="admin-console-panel">
          <header className="admin-console-panel__header">
            <p className="admin-console-panel__kicker">Session invalidation</p>
            <h3>세션 강제 만료</h3>
          </header>

          <form className="admin-console-form" onSubmit={handleForceLogout}>
            <label className="field" htmlFor="admin-force-member-uuid">
              <span className="field-label">Member UUID</span>
              <input
                id="admin-force-member-uuid"
                data-testid="admin-force-member-uuid"
                value={memberUuid}
                onChange={(event) => {
                  setMemberUuid(event.target.value);
                }}
                placeholder="예: member-001"
                type="text"
                autoComplete="off"
              />
            </label>

            <button
              className="admin-console-action admin-console-action--primary"
              type="submit"
              disabled={isForceLogoutSubmitting}
              data-testid="admin-force-submit"
            >
              {isForceLogoutSubmitting ? '요청 중...' : '선택 멤버 세션 무효화'}
            </button>

            {forceLogoutFeedback ? (
              <p className={`feedback feedback--${forceLogoutFeedback.tone}`} data-testid="admin-force-feedback">
                {forceLogoutFeedback.message}
              </p>
            ) : null}
          </form>
        </article>

        <article
          ref={auditSectionRef}
          className="admin-console-panel"
        >
          <header className="admin-console-panel__header">
            <p className="admin-console-panel__kicker">Audit search</p>
            <h3>감사 로그 검색</h3>
          </header>

          <form className="admin-console-form" onSubmit={handleAuditSearch}>
            <label className="field" htmlFor="admin-audit-member-id">
              <span className="field-label">멤버 UUID</span>
              <input
                id="admin-audit-member-id"
                data-testid="admin-audit-member-id"
                value={memberIdFilter}
                onChange={(event) => {
                  setMemberIdFilter(event.target.value);
                }}
                type="text"
              />
            </label>

            <label className="field" htmlFor="admin-audit-from">
              <span className="field-label">시작 시각 (from)</span>
              <input
                id="admin-audit-from"
                data-testid="admin-audit-from"
                value={fromFilter}
                onChange={(event) => {
                  setFromFilter(event.target.value);
                }}
                type="datetime-local"
              />
            </label>

            <label className="field" htmlFor="admin-audit-to">
              <span className="field-label">종료 시각 (to)</span>
              <input
                id="admin-audit-to"
                data-testid="admin-audit-to"
                value={toFilter}
                onChange={(event) => {
                  setToFilter(event.target.value);
                }}
                type="datetime-local"
              />
            </label>

            <label className="field" htmlFor="admin-audit-event-type">
              <span className="field-label">이벤트 타입</span>
              <select
                id="admin-audit-event-type"
                data-testid="admin-audit-event-type"
                value={eventTypeFilter}
                onChange={(event) => {
                  setEventTypeFilter(event.target.value);
                }}
              >
                <option value="">전체</option>
                {ADMIN_AUDIT_EVENT_TYPES.map((eventType) => (
                  <option key={eventType} value={eventType}>
                    {eventType}
                  </option>
                ))}
              </select>
            </label>

            <button
              className="admin-console-action admin-console-action--secondary"
              data-testid="admin-audit-search"
              type="submit"
            >
              조회
            </button>
          </form>

          <div className="admin-console-audit-meta" aria-live="polite">
            <p data-testid="admin-audit-count">
              총 {auditTotalElements}건 / 페이지 {auditPage + 1} / 크기 {auditSize}
            </p>
            {auditLoading ? <p data-testid="admin-audit-loading">감사 로그를 가져오는 중...</p> : null}
          </div>

          {auditError ? (
            <p className="feedback feedback--error" data-testid="admin-audit-error">
              {auditError.message}
            </p>
          ) : null}

          <section className="admin-console-table-shell" aria-busy={auditLoading}>
            <header className="admin-console-table-row admin-console-table-row--head">
              <span>시간</span>
              <span>멤버 UUID</span>
              <span>이벤트</span>
              <span>이메일</span>
              <span>IP</span>
              <span>요약</span>
            </header>

            {auditItems.length === 0 && !auditLoading ? (
              <p className="admin-console-empty" data-testid="admin-audit-empty">
                조건에 맞는 감사 로그가 없습니다.
              </p>
            ) : null}

            {auditItems.map((log) => (
              <article
                key={log.auditId}
                className="admin-console-table-row"
                data-testid={`admin-audit-row-${log.auditId}`}
              >
                <span>{formatAuditTime(log.createdAt)}</span>
                <span>{log.memberUuid}</span>
                <span>{log.eventType}</span>
                <span>{log.email}</span>
                <span>{log.ipAddress}</span>
                <span>{log.description}</span>
              </article>
            ))}
          </section>

          <div className="admin-console-table-footer">
            <div className="admin-console-page-sizes" role="group" aria-label="페이지 크기">
              {AUDIT_PAGE_SIZE_OPTIONS.map((size) => (
                <button
                  key={size}
                  type="button"
                  disabled={auditLoading}
                  className={`admin-console-action ${
                    auditSize === size
                      ? 'admin-console-action--primary admin-console-action--active'
                      : 'admin-console-action--muted'
                  }`}
                  data-testid={`admin-audit-size-${size}`}
                  onClick={() => {
                    handleAuditPageSize(size);
                  }}
                >
                  {size}개
                </button>
              ))}
            </div>

            <div className="admin-console-page-actions" aria-live="polite">
              <button
                className="admin-console-action admin-console-action--muted"
                type="button"
                data-testid="admin-audit-prev"
                disabled={auditPage === 0 || auditLoading}
                onClick={() => {
                  setAuditPage((current) => Math.max(0, current - 1));
                }}
              >
                이전
              </button>

              <span data-testid="admin-audit-page-indicator">
                {auditTotalPages === 0 ? 0 : auditPage + 1} / {auditTotalPages}
              </span>

              <button
                className="admin-console-action admin-console-action--muted"
                type="button"
                data-testid="admin-audit-next"
                disabled={auditPage >= Math.max(0, auditTotalPages - 1) || auditLoading}
                onClick={() => {
                  setAuditPage((current) => Math.min(auditTotalPages - 1, current + 1));
                }}
              >
                다음
              </button>
            </div>
          </div>
        </article>
      </section>

      <section className="admin-monitoring-shell" aria-labelledby="admin-monitoring-title">
        <header className="admin-console-panel admin-monitoring-shell__header">
          <div className="admin-console-panel__header">
            <p className="admin-console-panel__kicker">Operations monitoring</p>
            <h3 id="admin-monitoring-title">관측 대시보드</h3>
            <p className="admin-monitoring-shell__description">
              Grafana 패널과 감사 로그 drill-down을 연결해 데모 운영 상태를 빠르게 살펴봅니다.
            </p>
          </div>

          {monitoringConfig.status !== 'ready' ? (
            <p
              className="feedback feedback--error admin-monitoring-shell__feedback"
              data-testid="admin-monitoring-config-message"
            >
              {monitoringConfigMessage}
            </p>
          ) : null}
        </header>

        <div className="admin-monitoring-grid">
          {ADMIN_MONITORING_PANEL_KEYS.map((panelKey) => {
            const configuredPanel = monitoringConfig.status === 'ready'
              ? monitoringConfig.panelsByKey[panelKey]
              : undefined;
            const cardCopy = ADMIN_MONITORING_CARD_COPY[panelKey];

            if (!configuredPanel) {
              return (
                <article
                  key={panelKey}
                  className="admin-monitoring-card admin-monitoring-card--placeholder"
                  data-testid={`admin-monitoring-card-${panelKey}`}
                >
                  <header className="admin-console-panel__header">
                    <p className="admin-console-panel__kicker">Monitoring placeholder</p>
                    <h4>{cardCopy.title}</h4>
                    <p className="admin-monitoring-card__description">{cardCopy.description}</p>
                  </header>

                  <p
                    className="admin-monitoring-card__guidance"
                    data-testid={`admin-monitoring-guidance-${panelKey}`}
                  >
                    {monitoringConfigMessage}
                  </p>
                </article>
              );
            }

            return (
              <article
                key={configuredPanel.key}
                className="admin-monitoring-card"
                data-testid={`admin-monitoring-card-${configuredPanel.key}`}
              >
                <header className="admin-console-panel__header">
                  <p className="admin-console-panel__kicker">Monitoring panel</p>
                  <h4>{configuredPanel.title}</h4>
                  <p className="admin-monitoring-card__description">{configuredPanel.description}</p>
                </header>

                <div className="admin-monitoring-card__meta">
                  <span
                    className={`admin-monitoring-status ${
                      configuredPanel.freshness.status
                        ? `admin-monitoring-status--${configuredPanel.freshness.status}`
                        : ''
                    }`}
                    data-testid={`admin-monitoring-status-${configuredPanel.key}`}
                  >
                    {getMonitoringStatusText(configuredPanel)}
                  </span>
                  <span
                    className="admin-monitoring-card__last-updated"
                    data-testid={`admin-monitoring-last-updated-${configuredPanel.key}`}
                  >
                    {getMonitoringLastUpdatedText(configuredPanel)}
                  </span>
                  <span
                    className="admin-monitoring-card__metric-hint"
                    data-testid={`admin-monitoring-metric-hint-${configuredPanel.key}`}
                  >
                    {configuredPanel.sourceMetricHint}
                  </span>
                </div>

                {configuredPanel.mode === 'embed' && configuredPanel.embedUrl ? (
                  <iframe
                    className="admin-monitoring-card__embed"
                    data-testid={`admin-monitoring-embed-${configuredPanel.key}`}
                    loading="lazy"
                    src={configuredPanel.embedUrl}
                    title={`${configuredPanel.title} Grafana panel`}
                  />
                ) : (
                  <p
                    className="admin-monitoring-card__guidance"
                    data-testid={`admin-monitoring-link-mode-${configuredPanel.key}`}
                  >
                    내부 Grafana 링크 방식으로 열립니다.
                  </p>
                )}

                <div className="admin-monitoring-card__actions">
                  <a
                    className="admin-console-action admin-console-action--secondary"
                    data-testid={`admin-monitoring-open-${configuredPanel.key}`}
                    href={configuredPanel.linkUrl}
                    rel="noreferrer"
                    target="_blank"
                  >
                    대시보드 열기
                  </a>

                  <a
                    className="admin-console-action admin-console-action--muted"
                    data-testid={`admin-monitoring-drilldown-${configuredPanel.key}`}
                    href={configuredPanel.drillDown.grafanaUrl}
                    rel="noreferrer"
                    target="_blank"
                  >
                    패널 상세
                  </a>

                  {configuredPanel.freshness.companionPanelUrl ? (
                    <a
                      className="admin-console-action admin-console-action--muted"
                      data-testid={`admin-monitoring-freshness-${configuredPanel.key}`}
                      href={configuredPanel.freshness.companionPanelUrl}
                      rel="noreferrer"
                      target="_blank"
                    >
                      Freshness 패널
                    </a>
                  ) : null}

                  {configuredPanel.drillDown.adminAuditUrl
                    || ADMIN_MONITORING_AUDIT_SHORTCUTS[configuredPanel.key] ? (
                    <button
                      className="admin-console-action admin-console-action--muted"
                      data-testid={`admin-monitoring-audit-${configuredPanel.key}`}
                      type="button"
                      onClick={() => {
                        handleMonitoringAuditDrillDown(configuredPanel);
                      }}
                    >
                      관련 감사 로그
                    </button>
                    ) : null}
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </section>
  );
}
