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
          code: 'CORE-002',
          message: 'Insufficient position',
          detail: 'Insufficient quantity for requested order',
          timestamp: '2026-03-02T00:00:00Z',
        },
        traceId: 'trace-auth-001',
      },
      headers: {},
      status: 422,
      statusText: 'Unprocessable Entity',
    });

    const normalized = normalizeApiError(err);

    expect(normalized.message).toBe('Insufficient position');
    expect(normalized.code).toBe('CORE-002');
    expect(normalized.status).toBe(422);
    expect(normalized.traceId).toBe('trace-auth-001');
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
