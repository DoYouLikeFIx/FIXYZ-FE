import { isAxiosError } from 'axios';
import { type FormEvent, useEffect, useRef, useState } from 'react';

import { fetchAdminAuditLogs, invalidateMemberSessions } from '@/api/adminApi';
import { getAuthErrorMessage } from '@/lib/auth-errors';
import {
  ADMIN_AUDIT_EVENT_TYPES,
  type AdminAuditEventType,
  type AdminAuditLog,
  type AdminAuditLogQuery,
} from '@/types/admin';

const AUDIT_PAGE_SIZE_OPTIONS = [20, 50, 100] as const;

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

export function AdminConsolePage() {
  const [memberUuid, setMemberUuid] = useState('');
  const [forceLogoutFeedback, setForceLogoutFeedback] = useState<FeedbackState | null>(null);
  const [isForceLogoutSubmitting, setIsForceLogoutSubmitting] = useState(false);

  const [memberIdFilter, setMemberIdFilter] = useState('');
  const [fromFilter, setFromFilter] = useState('');
  const [toFilter, setToFilter] = useState('');
  const [eventTypeFilter, setEventTypeFilter] = useState('');
  const [appliedMemberIdFilter, setAppliedMemberIdFilter] = useState('');
  const [appliedFromFilter, setAppliedFromFilter] = useState('');
  const [appliedToFilter, setAppliedToFilter] = useState('');
  const [appliedEventTypeFilter, setAppliedEventTypeFilter] = useState('');

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

  const currentAuditQuery: AdminAuditLogQuery = {
    page: auditPage,
    size: auditSize,
    memberId: normalizeFilter(appliedMemberIdFilter),
    from: normalizeFilter(appliedFromFilter),
    to: normalizeFilter(appliedToFilter),
    eventType: appliedEventTypeFilter
      ? (appliedEventTypeFilter as AdminAuditEventType)
      : undefined,
  };

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

      if (latestAuditLogRequestIdRef.current !== requestId) {
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
  }, [auditPage, auditSize, appliedMemberIdFilter, appliedFromFilter, appliedToFilter, appliedEventTypeFilter]);

  useEffect(() => () => {
    latestAuditLogAbortControllerRef.current?.abort();
  }, []);

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

  return (
    <section className="admin-console-shell">
      <header className="admin-console-hero">
        <p className="status-kicker">Admin security console</p>
        <h2 data-testid="admin-console-title">운영자 세션 제어</h2>
        <p className="admin-console-hero__description">
          강제 로그아웃 대상 멤버 ID를 입력해 세션을 무효화하고, 감사 로그를 필터링해서 확인하세요.
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

        <article className="admin-console-panel">
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
    </section>
  );
}
