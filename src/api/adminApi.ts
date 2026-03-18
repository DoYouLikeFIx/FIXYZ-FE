import { api } from '@/lib/axios';
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
): Promise<AdminAuditLogsPage> => {
  const response = await api.get<AdminAuditLogsPage>('/api/v1/admin/audit-logs', {
    params: purgeUndefinedParams({
      page: query.page,
      size: query.size,
      from: query.from,
      to: query.to,
      memberId: query.memberId,
      eventType: query.eventType,
    }),
  });

  return response.data;
};
