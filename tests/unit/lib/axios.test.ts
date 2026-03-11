import { AxiosError } from 'axios';

import {
  DEFAULT_SERVER_ERROR_MESSAGE,
  FORBIDDEN_ERROR_MESSAGE,
  NETWORK_ERROR_MESSAGE,
  TIMEOUT_ERROR_MESSAGE,
  isApiResponseEnvelope,
  normalizeApiError,
} from '@/lib/axios';

describe('axios helpers', () => {
  it('detects valid API response envelopes', () => {
    expect(
      isApiResponseEnvelope({ success: true, data: { value: 1 }, error: null }),
    ).toBe(true);
    expect(isApiResponseEnvelope({ message: 'oops' })).toBe(false);
  });

  it('normalizes backend contract errors', () => {
    const err = new AxiosError('Request failed', 'ERR_BAD_REQUEST', undefined, undefined, {
      config: {} as never,
      data: {
        success: false,
        data: null,
        error: {
          code: 'FEP-001',
          message: '주문 서비스를 잠시 사용할 수 없습니다',
          detail: '거래소 연결이 일시적으로 불안정합니다. 주문이 접수되지 않았을 수 있습니다.',
          operatorCode: 'CIRCUIT_OPEN',
          retryAfterSeconds: 10,
          timestamp: '2026-03-02T00:00:00Z',
        },
        traceId: 'trace-auth-001',
      },
      headers: {
        'retry-after': '120',
      },
      status: 422,
      statusText: 'Unprocessable Entity',
    });

    const normalized = normalizeApiError(err);

    expect(normalized.message).toBe('주문 서비스를 잠시 사용할 수 없습니다');
    expect(normalized.code).toBe('FEP-001');
    expect(normalized.status).toBe(422);
    expect(normalized.traceId).toBe('trace-auth-001');
    expect(normalized.operatorCode).toBe('CIRCUIT_OPEN');
    expect(normalized.retryAfterSeconds).toBe(10);
  });

  it('falls back to the Retry-After header when the payload omits retry guidance', () => {
    const err = new AxiosError('Request failed', 'ERR_BAD_REQUEST', undefined, undefined, {
      config: {} as never,
      data: {
        success: false,
        data: null,
        error: {
          code: 'AUTH-011',
          message: 'Too many password recovery attempts',
          detail: 'Please wait before trying again.',
          timestamp: '2026-03-02T00:00:00Z',
        },
        traceId: 'trace-auth-002',
      },
      headers: {
        'retry-after': '120',
      },
      status: 429,
      statusText: 'Too Many Requests',
    });

    const normalized = normalizeApiError(err);

    expect(normalized.code).toBe('AUTH-011');
    expect(normalized.status).toBe(429);
    expect(normalized.retryAfterSeconds).toBe(120);
    expect(normalized.traceId).toBe('trace-auth-002');
  });

  it('normalizes direct backend error responses used by spring security entry points', () => {
    const err = new AxiosError('Request failed', 'ERR_BAD_REQUEST', undefined, undefined, {
      config: {} as never,
      data: {
        code: 'AUTH-003',
        message: 'authentication required',
        path: '/api/v1/auth/session',
        correlationId: 'corr-123',
        timestamp: '2026-03-09T00:00:00Z',
      },
      headers: {},
      status: 401,
      statusText: 'Unauthorized',
    });

    const normalized = normalizeApiError(err);

    expect(normalized.message).toBe('authentication required');
    expect(normalized.code).toBe('AUTH-003');
    expect(normalized.status).toBe(401);
    expect(normalized.traceId).toBe('corr-123');
  });

  it('normalizes timeout errors', () => {
    const err = new AxiosError('timeout', AxiosError.ECONNABORTED);

    expect(normalizeApiError(err).message).toBe(TIMEOUT_ERROR_MESSAGE);
  });

  it('normalizes network failures', () => {
    const err = new AxiosError('network failed', 'ERR_NETWORK');

    expect(normalizeApiError(err).message).toBe(NETWORK_ERROR_MESSAGE);
  });

  it('normalizes forbidden responses with the localized refresh guidance', () => {
    const err = new AxiosError('forbidden', 'ERR_BAD_REQUEST', undefined, undefined, {
      config: {} as never,
      data: '',
      headers: {},
      status: 403,
      statusText: 'Forbidden',
    });

    expect(normalizeApiError(err).message).toBe(FORBIDDEN_ERROR_MESSAGE);
  });

  it('falls back for non-axios errors', () => {
    expect(normalizeApiError(new Error('x')).message).toBe(DEFAULT_SERVER_ERROR_MESSAGE);
  });
});
