import { api, createNormalizedApiError } from '@/lib/axios';
import type {
  AdminAuditLogQuery,
  AdminAuditLogsPage,
  AdminSessionInvalidationPayload,
  AdminSessionInvalidationResponse,
} from '@/types/admin';

const purgeUndefinedParams = <T extends Record<string, unknown>>(params: T) =>
  Object.fromEntries(
    Object.entries(params).filter(([, value]) => value !== undefined),
  ) as { [K in keyof T]: Exclude<T[K], undefined> };

const assertPaginationIsSafe = (query: AdminAuditLogQuery) => {
  if (query.page !== undefined && (!Number.isInteger(query.page) || query.page < 0)) {
    throw createNormalizedApiError(
      '조회 조건이 올바르지 않습니다.',
      {
        status: 422,
        code: 'VALIDATION-001',
        detail: 'page는 0 이상의 정수여야 합니다.',
      },
    );
  }

  if (query.size !== undefined) {
    if (!Number.isInteger(query.size)) {
      throw createNormalizedApiError(
        '조회 조건이 올바르지 않습니다.',
        {
          status: 422,
          code: 'VALIDATION-001',
          detail: 'size는 정수여야 합니다.',
        },
      );
    }

    if (query.size < 1 || query.size > 100) {
      throw createNormalizedApiError(
        '페이지 크기는 1에서 100 사이여야 합니다.',
        {
          status: 422,
          code: 'VALIDATION-001',
          detail: 'size는 1에서 100 사이여야 합니다.',
        },
      );
    }
  }

  const isoLike = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}/;

  if (query.from !== undefined && !isoLike.test(query.from)) {
    throw createNormalizedApiError(
      '조회 조건이 올바르지 않습니다.',
      {
        status: 422,
        code: 'VALIDATION-001',
        detail: 'from은 ISO-8601 형식이어야 합니다.',
      },
    );
  }

  if (query.to !== undefined && !isoLike.test(query.to)) {
    throw createNormalizedApiError(
      '조회 조건이 올바르지 않습니다.',
      {
        status: 422,
        code: 'VALIDATION-001',
        detail: 'to는 ISO-8601 형식이어야 합니다.',
      },
    );
  }
};

export const invalidateMemberSessions = async (
  payload: AdminSessionInvalidationPayload,
): Promise<AdminSessionInvalidationResponse> => {
  const memberUuid = encodeURIComponent(payload.memberUuid);
  const response = await api.delete<AdminSessionInvalidationResponse>(
    `/api/v1/admin/members/${memberUuid}/sessions`,
  );

  return response.data;
};

export const fetchAdminAuditLogs = async (
  query: AdminAuditLogQuery = {},
  signal?: AbortSignal,
): Promise<AdminAuditLogsPage> => {
  assertPaginationIsSafe(query);

  const response = await api.get<AdminAuditLogsPage>('/api/v1/admin/audit-logs', {
    params: purgeUndefinedParams({
      page: query.page,
      size: query.size,
      from: query.from,
      to: query.to,
      memberId: query.memberId,
      eventType: query.eventType,
    }),
    signal,
  });

  return response.data;
};
