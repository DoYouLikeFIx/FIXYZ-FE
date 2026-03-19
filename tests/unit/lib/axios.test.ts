import { AxiosError, type AxiosResponse } from 'axios';

import {
  DEFAULT_SERVER_ERROR_MESSAGE,
  FORBIDDEN_ERROR_MESSAGE,
  NETWORK_ERROR_MESSAGE,
  TIMEOUT_ERROR_MESSAGE,
  getApiErrorDiagnosticContext,
  getApiErrorDiagnosticLog,
  isApiResponseEnvelope,
  normalizeApiError,
  unwrapApiResponseEnvelope,
} from '@/lib/axios';
import type { LenientApiResponseEnvelope } from '@/types/api';

describe('axios helpers', () => {
  it('detects valid API response envelopes', () => {
    expect(
      isApiResponseEnvelope({ success: true, data: { value: 1 }, error: null }),
    ).toBe(true);
    expect(
      isApiResponseEnvelope({ success: true, data: { value: 1 }, timestamp: '2026-03-16T00:00:00Z' }),
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
        'x-correlation-id': 'header-trace-ignored',
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

  it('falls back to the response correlation header when an envelope omits traceId', () => {
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
      },
      headers: {
        'x-correlation-id': 'header-trace-001',
      },
      status: 422,
      statusText: 'Unprocessable Entity',
    });

    const normalized = normalizeApiError(err);

    expect(normalized.traceId).toBe('header-trace-001');
  });

  it('uses the first correlation header value when intermediaries append multiple ids', () => {
    const err = new AxiosError('Request failed', 'ERR_BAD_REQUEST', undefined, undefined, {
      config: {} as never,
      data: {
        code: 'AUTH-999',
        message: 'internal backend detail',
        path: '/api/v1/auth/login',
        timestamp: '2026-03-19T00:00:00Z',
      },
      headers: {
        'x-correlation-id': 'corr-primary-001, corr-secondary-ignored',
      },
      status: 500,
      statusText: 'Internal Server Error',
    });

    const normalized = normalizeApiError(err);

    expect(normalized.traceId).toBe('corr-primary-001');
  });

  it('uses the response-envelope failure path to preserve a header correlation id', () => {
    const response = {
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
      },
      headers: {
        'x-correlation-id': 'header-trace-unwrap-001',
      },
      request: {},
      status: 200,
      statusText: 'OK',
    } as AxiosResponse<LenientApiResponseEnvelope<unknown>>;

    try {
      unwrapApiResponseEnvelope(response);
      throw new Error('Expected unwrapApiResponseEnvelope to throw');
    } catch (error) {
      const normalized = error as ReturnType<typeof normalizeApiError>;
      expect(normalized.traceId).toBe('header-trace-unwrap-001');
    }
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
      headers: {
        'x-correlation-id': 'header-correlation-ignored',
      },
      status: 401,
      statusText: 'Unauthorized',
    });

    const normalized = normalizeApiError(err);

    expect(normalized.message).toBe('authentication required');
    expect(normalized.code).toBe('AUTH-003');
    expect(normalized.status).toBe(401);
    expect(normalized.traceId).toBe('corr-123');
  });

  it('falls back to the response correlation header for direct backend error payloads', () => {
    const err = new AxiosError('Request failed', 'ERR_BAD_REQUEST', undefined, undefined, {
      config: {} as never,
      data: {
        code: 'AUTH-003',
        message: 'authentication required',
        path: '/api/v1/auth/session',
        timestamp: '2026-03-09T00:00:00Z',
      },
      headers: {
        'x-correlation-id': 'header-correlation-002',
      },
      status: 401,
      statusText: 'Unauthorized',
    });

    const normalized = normalizeApiError(err);

    expect(normalized.traceId).toBe('header-correlation-002');
  });

  it('builds a PII-safe diagnostic context for normalized api errors', () => {
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
          cookie: 'session=secret',
          csrfToken: 'csrf-secret',
          requestBody: { accountNumber: '123-456-7890' },
          accountNumber: '123-456-7890',
        },
        traceId: 'trace-safe-001',
      },
      headers: {},
      status: 422,
      statusText: 'Unprocessable Entity',
    });

    const normalized = normalizeApiError(err) as unknown as Record<string, unknown>;
    const diagnosticContext = getApiErrorDiagnosticContext(normalized);

    expect(normalized.traceId).toBe('trace-safe-001');
    expect(normalized.operatorCode).toBe('CIRCUIT_OPEN');
    expect(normalized.retryAfterSeconds).toBe(10);
    expect(diagnosticContext).toEqual({
      code: 'FEP-001',
      operatorCode: 'CIRCUIT_OPEN',
      remainingAttempts: undefined,
      retryAfterSeconds: 10,
      status: 422,
      traceId: 'trace-safe-001',
      traceparent: undefined,
      userMessageKey: undefined,
    });
    expect(normalized).not.toHaveProperty('cookie');
    expect(normalized).not.toHaveProperty('csrfToken');
    expect(normalized).not.toHaveProperty('requestBody');
    expect(normalized).not.toHaveProperty('accountNumber');
    expect(diagnosticContext).not.toHaveProperty('message');
    expect(diagnosticContext).not.toHaveProperty('detail');
  });

  it('sanitizes preexisting diagnostic context objects before returning them', () => {
    const diagnosticContext = getApiErrorDiagnosticContext({
      name: 'ApiClientError',
      diagnosticContext: {
        code: 'AUTH-999',
        status: 500,
        traceId: 'corr-safe-001',
        traceparent: '00-1234567890abcdef1234567890abcdef-1234567890abcdef-01',
        cookie: 'secret-cookie',
        detail: 'sensitive@example.com',
      },
    });

    expect(diagnosticContext).toEqual({
      code: 'AUTH-999',
      status: 500,
      traceId: 'corr-safe-001',
      traceparent: '00-1234567890abcdef1234567890abcdef-1234567890abcdef-01',
      operatorCode: undefined,
      retryAfterSeconds: undefined,
      remainingAttempts: undefined,
      userMessageKey: undefined,
    });
    expect(diagnosticContext).not.toHaveProperty('cookie');
    expect(diagnosticContext).not.toHaveProperty('detail');
  });

  it('does not treat unrelated errors with incidental code fields as api diagnostics', () => {
    const diagnosticContext = getApiErrorDiagnosticContext({
      name: 'CustomValidationError',
      code: 'FORM_REQUIRED',
      message: 'Field missing',
    });

    expect(diagnosticContext).toBeUndefined();
  });

  it('builds a safe diagnostic log with stack frames for normalized api errors', () => {
    const error = normalizeApiError(
      new AxiosError('Request failed', 'ERR_BAD_REQUEST', undefined, undefined, {
        config: {} as never,
        data: {
          code: 'AUTH-999',
          message: 'internal backend detail',
          path: '/api/v1/auth/login',
          timestamp: '2026-03-19T00:00:00Z',
        },
        headers: {
          'x-correlation-id': 'corr-log-001',
          traceparent:
            '00-1234567890abcdef1234567890abcdef-1234567890abcdef-01',
        },
        status: 500,
        statusText: 'Internal Server Error',
      }),
    );

    const diagnosticLog = getApiErrorDiagnosticLog(error);

    expect(diagnosticLog).toMatchObject({
      code: 'AUTH-999',
      status: 500,
      traceId: 'corr-log-001',
      traceparent:
        '00-1234567890abcdef1234567890abcdef-1234567890abcdef-01',
    });
    expect(diagnosticLog?.stackFrames).toEqual(expect.any(Array));
    expect(diagnosticLog?.stackFrames?.[0]).not.toContain('internal backend detail');
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
      headers: {
        'x-correlation-id': 'forbidden-corr-001',
      },
      status: 403,
      statusText: 'Forbidden',
    });

    const normalized = normalizeApiError(err);

    expect(normalized.message).toBe(FORBIDDEN_ERROR_MESSAGE);
    expect(normalized.traceId).toBe('forbidden-corr-001');
  });

  it('falls back for non-axios errors', () => {
    expect(normalizeApiError(new Error('x')).message).toBe(DEFAULT_SERVER_ERROR_MESSAGE);
  });
});
