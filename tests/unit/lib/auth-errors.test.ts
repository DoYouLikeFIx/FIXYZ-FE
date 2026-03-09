import type { NormalizedApiError } from '@/lib/axios';
import {
  getAuthErrorMessage,
  getReauthMessage,
  isReauthError,
} from '@/lib/auth-errors';

const createApiError = (
  overrides: Partial<NormalizedApiError> & { message?: string } = {},
): NormalizedApiError => {
  const error = new Error(
    overrides.message ?? 'Unexpected server response. Please try again.',
  ) as NormalizedApiError;

  error.name = 'ApiClientError';
  error.code = overrides.code;
  error.status = overrides.status;

  return error;
};

describe('auth error messages', () => {
  it('maps credential failures to the canonical login message', () => {
    expect(
      getAuthErrorMessage(
        createApiError({ code: 'AUTH-001', message: 'Credential mismatch' }),
      ),
    ).toBe('아이디 또는 비밀번호가 올바르지 않습니다.');
  });

  it('maps duplicate username failures for register flow', () => {
    expect(
      getAuthErrorMessage(
        createApiError({ code: 'AUTH-008', message: 'Username already exists' }),
      ),
    ).toBe('이미 사용 중인 아이디입니다. 다른 아이디를 선택해 주세요.');
  });

  it('maps lockout and rate-limit failures to the canonical abuse-protection messages', () => {
    expect(
      getAuthErrorMessage(
        createApiError({ code: 'AUTH-002', message: 'Account locked' }),
      ),
    ).toBe('로그인 시도가 잠겨 있습니다. 잠시 후 다시 시도해 주세요.');

    expect(
      getAuthErrorMessage(
        createApiError({ code: 'RATE-001', message: 'Too many attempts' }),
      ),
    ).toBe('로그인 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.');
  });

  it('detects auth-expiry codes that require re-authentication', () => {
    expect(isReauthError(createApiError({ code: 'AUTH-003', status: 401 }))).toBe(
      true,
    );
    expect(isReauthError(createApiError({ code: 'CHANNEL-001', status: 410 }))).toBe(
      true,
    );
    expect(isReauthError(createApiError({ code: 'AUTH-016', status: 401 }))).toBe(
      true,
    );
    expect(isReauthError(createApiError({ code: 'AUTH-001', status: 401 }))).toBe(
      false,
    );
  });

  it('returns the standardized re-auth guidance message', () => {
    expect(
      getReauthMessage(createApiError({ code: 'CHANNEL-001', status: 410 })),
    ).toBe('세션이 만료되었습니다. 다시 로그인해 주세요.');
  });
});
