import type { NormalizedApiError } from '@/lib/axios';
import {
  getAuthErrorMessage,
  getReauthMessage,
  isReauthError,
  resolveMfaErrorPresentation,
  resolveAuthErrorPresentation,
} from '@/lib/auth-errors';
import { NETWORK_ERROR_MESSAGE } from '@/lib/axios';
import { authErrorContract } from '../../fixtures/auth-error-contract';

const createApiError = (
  overrides: Partial<NormalizedApiError> & { message?: string } = {},
): NormalizedApiError => {
  const error = new Error(
    overrides.message ?? 'Unexpected server response. Please try again.',
  ) as NormalizedApiError;

  error.name = 'ApiClientError';
  error.code = overrides.code;
  error.status = overrides.status;
  error.retryAfterSeconds = overrides.retryAfterSeconds;
  error.traceId = overrides.traceId;
  error.recoveryUrl = overrides.recoveryUrl;

  return error;
};

describe('auth error messages', () => {
  for (const { codes, semantic, recoveryAction, message } of authErrorContract.cases) {
    it(`matches the FE auth contract for ${codes.join(', ')}`, () => {
      for (const code of codes) {
        const presentation = resolveAuthErrorPresentation(
          createApiError({ code, message: `${code} server message` }),
        );

        expect(presentation.semantic).toBe(semantic);
        expect(presentation.recoveryAction).toBe(recoveryAction);
        expect(presentation.message).toBe(message);
        expect(getAuthErrorMessage(createApiError({ code }))).toBe(message);
      }
    });
  }

  it('maps duplicate email failures for register flow', () => {
    expect(
      getAuthErrorMessage(
        createApiError({ code: 'AUTH-017', message: 'Email already exists' }),
      ),
    ).toBe('이미 가입된 이메일입니다. 다른 이메일을 입력해 주세요.');
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

  it('maps reset-token failures to deterministic recovery guidance', () => {
    expect(
      getAuthErrorMessage(
        createApiError({ code: 'AUTH-012', status: 401 }),
      ),
    ).toBe('재설정 링크가 유효하지 않거나 만료되었습니다. 비밀번호 재설정을 다시 요청해 주세요.');
    expect(
      getAuthErrorMessage(
        createApiError({ code: 'AUTH-013', status: 409 }),
      ),
    ).toBe('이미 사용된 재설정 링크입니다. 새로운 재설정 링크를 요청해 주세요.');
    expect(
      getAuthErrorMessage(
        createApiError({ code: 'AUTH-015', status: 422 }),
      ),
    ).toBe('현재 비밀번호와 다른 새 비밀번호를 입력해 주세요.');
  });

  it('includes Retry-After guidance for recovery rate limits', () => {
    expect(
      getAuthErrorMessage(
        createApiError({
          code: 'AUTH-014',
          retryAfterSeconds: 45,
          status: 429,
        }),
      ),
    ).toBe('비밀번호 재설정 요청이 너무 많습니다. 45초 후 다시 시도해 주세요.');
  });

  it('maps MFA recovery proof failures to deterministic retry guidance', () => {
    expect(
      resolveMfaErrorPresentation(createApiError({ code: 'AUTH-019', status: 401 })),
    ).toMatchObject({
      code: 'AUTH-019',
      message: '복구 단계가 유효하지 않거나 만료되었습니다. 비밀번호 재설정을 다시 진행해 주세요.',
      navigateToRecovery: false,
      restartLogin: false,
    });

    expect(
      resolveMfaErrorPresentation(createApiError({ code: 'AUTH-020', status: 409 })),
    ).toMatchObject({
      code: 'AUTH-020',
      message: '이미 사용된 복구 단계입니다. 비밀번호 재설정을 다시 진행해 주세요.',
      navigateToRecovery: false,
      restartLogin: false,
    });
  });

  it('surfaces recovery navigation metadata for MFA recovery-required errors', () => {
    expect(
      resolveMfaErrorPresentation(
        createApiError({
          code: 'AUTH-021',
          status: 403,
          recoveryUrl: '/mfa-recovery',
        }),
      ),
    ).toMatchObject({
      code: 'AUTH-021',
      navigateToRecovery: true,
      recoveryUrl: '/mfa-recovery',
      message: '기존 인증기를 사용할 수 없어 복구가 필요합니다. 새 인증 앱을 연결하는 복구 단계를 진행해 주세요.',
    });
  });
});
