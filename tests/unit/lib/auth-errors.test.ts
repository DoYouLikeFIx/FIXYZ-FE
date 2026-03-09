import authErrorContract from '../../../../docs/contracts/auth-error-standardization.json';
import type { NormalizedApiError } from '@/lib/axios';
import {
  getAuthErrorMessage,
  getReauthMessage,
  isReauthError,
  resolveAuthErrorPresentation,
} from '@/lib/auth-errors';
import { NETWORK_ERROR_MESSAGE } from '@/lib/axios';

const createApiError = (
  overrides: Partial<NormalizedApiError> & { message?: string } = {},
): NormalizedApiError => {
  const error = new Error(
    overrides.message ?? 'Unexpected server response. Please try again.',
  ) as NormalizedApiError;

  error.name = 'ApiClientError';
  error.code = overrides.code;
  error.status = overrides.status;
  error.traceId = overrides.traceId;

  return error;
};

describe('auth error messages', () => {
  it.each(authErrorContract.cases)(
    'matches the FE auth contract for %s',
    ({ codes, semantic, recoveryAction, message }) => {
      for (const code of codes) {
        const presentation = resolveAuthErrorPresentation(
          createApiError({ code, message: `${code} server message` }),
        );

        expect(presentation.semantic).toBe(semantic);
        expect(presentation.recoveryAction).toBe(recoveryAction);
        expect(presentation.message).toBe(message);
        expect(getAuthErrorMessage(createApiError({ code }))).toBe(message);
      }
    },
  );

  it('maps duplicate username failures for register flow', () => {
    expect(
      getAuthErrorMessage(
        createApiError({ code: 'AUTH-008', message: 'Username already exists' }),
      ),
    ).toBe('이미 사용 중인 아이디입니다. 다른 아이디를 선택해 주세요.');
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

  it('uses the safe fallback and exposes the correlation id for unknown backend codes', () => {
    const presentation = resolveAuthErrorPresentation(
      createApiError({
        code: 'AUTH-999',
        message: 'Raw backend exception should not leak',
        traceId: 'corr-123',
      }),
    );

    expect(presentation.semantic).toBe(authErrorContract.unknownFallback.semantic);
    expect(presentation.recoveryAction).toBe(
      authErrorContract.unknownFallback.recoveryAction,
    );
    expect(presentation.message).toBe(
      `${authErrorContract.unknownFallback.message} ${authErrorContract.supportReferenceLabel}: corr-123`,
    );
  });

  it('preserves client-generated transport guidance when no backend auth code exists', () => {
    expect(
      getAuthErrorMessage(createApiError({ message: NETWORK_ERROR_MESSAGE })),
    ).toBe(NETWORK_ERROR_MESSAGE);
  });
});
