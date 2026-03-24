export const ADMIN_AUDIT_EVENT_TYPES = [
  'LOGIN_SUCCESS',
  'LOGIN_FAIL',
  'LOGOUT',
  'ADMIN_FORCE_LOGOUT',
  'ORDER_SESSION_CREATE',
  'ORDER_OTP_SUCCESS',
  'ORDER_OTP_FAIL',
  'ORDER_EXECUTE',
  'ORDER_CANCEL',
  'MANUAL_REPLAY',
  'TOTP_ENROLL',
  'TOTP_CONFIRM',
] as const;

export type AdminAuditEventType = (typeof ADMIN_AUDIT_EVENT_TYPES)[number];

export const isAdminAuditEventType = (
  value: string | null | undefined,
): value is AdminAuditEventType =>
  value !== undefined
  && value !== null
  && ADMIN_AUDIT_EVENT_TYPES.includes(value as AdminAuditEventType);

export interface AdminSessionInvalidationResponse {
  memberUuid: string;
  invalidatedCount: number;
  message: string;
}

export interface AdminAuditLog {
  auditId: string;
  memberUuid: string;
  email: string;
  eventType: AdminAuditEventType;
  ipAddress: string;
  userAgent: string;
  description: string;
  clOrdId: string | null;
  orderSessionId: string | null;
  createdAt: string;
}

export interface AdminAuditLogsPage {
  content: AdminAuditLog[];
  totalElements: number;
  totalPages: number;
  number: number;
  size: number;
}

export interface AdminAuditLogQuery {
  page?: number;
  size?: number;
  from?: string;
  to?: string;
  memberId?: string;
  eventType?: AdminAuditEventType;
}

export interface AdminSessionInvalidationPayload {
  memberUuid: string;
}
