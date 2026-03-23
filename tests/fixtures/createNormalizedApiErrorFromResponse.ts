import { AxiosError } from 'axios';

import { normalizeApiError, type NormalizedApiError } from '@/lib/axios';

type CreateNormalizedApiErrorFromResponseOptions = {
  code: string;
  message: string;
  status: number;
  detail?: string;
  details?: Record<string, unknown>;
  path?: string;
  traceId?: string;
  correlationId?: string;
  correlationIdHeader?: string;
  traceparentHeader?: string;
  operatorCode?: string;
  retryAfterSeconds?: number;
  remainingAttempts?: number;
  enrollUrl?: string;
  recoveryUrl?: string;
  userMessageKey?: string;
  responseShape?: 'direct' | 'envelope';
};

export const createNormalizedApiErrorFromResponse = (
  options: CreateNormalizedApiErrorFromResponseOptions,
): NormalizedApiError =>
  normalizeApiError(
    new AxiosError('Request failed', 'ERR_BAD_REQUEST', undefined, undefined, {
      config: {} as never,
      data:
        options.responseShape === 'envelope'
          ? {
              success: false,
              data: null,
              error: {
                code: options.code,
                message: options.message,
                detail: options.detail,
                details: options.details,
                operatorCode: options.operatorCode,
                retryAfterSeconds: options.retryAfterSeconds,
                remainingAttempts: options.remainingAttempts,
                enrollUrl: options.enrollUrl,
                recoveryUrl: options.recoveryUrl,
                userMessageKey: options.userMessageKey,
                timestamp: '2026-03-19T00:00:00Z',
              },
              traceId: options.traceId,
            }
          : {
              code: options.code,
              message: options.message,
              path: options.path ?? '/api/v1/auth/login',
              correlationId: options.correlationId,
              details: options.details,
              operatorCode: options.operatorCode,
              retryAfterSeconds: options.retryAfterSeconds,
              remainingAttempts: options.remainingAttempts,
              enrollUrl: options.enrollUrl,
              recoveryUrl: options.recoveryUrl,
              userMessageKey: options.userMessageKey,
              timestamp: '2026-03-19T00:00:00Z',
            },
      headers: {
        ...(options.correlationIdHeader
          ? {
              'x-correlation-id': options.correlationIdHeader,
            }
          : {}),
        ...(options.traceparentHeader
          ? {
              traceparent: options.traceparentHeader,
            }
          : {}),
      },
      status: options.status,
      statusText: 'Request failed',
    }),
  );
