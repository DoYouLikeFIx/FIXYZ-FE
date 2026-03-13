import {
  beginTotpEnrollment,
  bootstrapAuthenticatedTotpRebind,
  bootstrapRecoveryTotpRebind,
  confirmTotpEnrollment,
  confirmMfaRecoveryRebind,
  fetchSession,
  requestPasswordRecoveryChallenge,
  requestPasswordResetEmail,
  registerMember,
  resetPassword,
  startLoginFlow,
  verifyLoginOtp,
} from '@/api/authApi';
import type { Member } from '@/types/auth';

const mockGet = vi.fn();
const mockPost = vi.fn();
const mockFetchCsrfToken = vi.fn();
const mockClearCsrfToken = vi.fn();

vi.mock('@/lib/axios', () => ({
  api: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
  },
  fetchCsrfToken: (forceRefresh?: boolean) => mockFetchCsrfToken(forceRefresh),
  clearCsrfToken: () => mockClearCsrfToken(),
}));

const memberFixture: Member = {
  memberUuid: 'member-001',
  email: 'demo@fix.com',
  name: 'Demo User',
  role: 'ROLE_USER',
  totpEnrolled: true,
  accountId: '1',
};

describe('auth api', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockPost.mockReset();
    mockFetchCsrfToken.mockReset();
    mockClearCsrfToken.mockReset();
  });

  it('fetches the current session with auth-failure handling disabled', async () => {
    mockGet.mockResolvedValue({ data: memberFixture });

    await expect(fetchSession()).resolves.toEqual(memberFixture);
    expect(mockGet).toHaveBeenCalledWith('/api/v1/auth/session', {
      _skipAuthHandling: true,
    });
  });

  it('starts the login challenge using the password-only pre-auth contract', async () => {
    mockPost.mockResolvedValue({
      data: {
        loginToken: 'login-token',
        nextAction: 'VERIFY_TOTP',
        totpEnrolled: true,
        expiresAt: '2026-03-12T10:00:00Z',
      },
    });

    await expect(
      startLoginFlow({ email: 'demo@fix.com', password: 'Test1234!' }),
    ).resolves.toEqual({
      loginToken: 'login-token',
      nextAction: 'VERIFY_TOTP',
      totpEnrolled: true,
      expiresAt: '2026-03-12T10:00:00Z',
    });

    const [url, body, options] = mockPost.mock.calls[0] ?? [];
    expect(url).toBe('/api/v1/auth/login');
    expect(body).toBeInstanceOf(URLSearchParams);
    expect((body as URLSearchParams).toString()).toBe(
      'email=demo%40fix.com&password=Test1234%21',
    );
    expect(options).toEqual({
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      _skipAuthHandling: true,
    });
    expect(mockFetchCsrfToken).not.toHaveBeenCalled();
  });

  it('registers a member and clears the cached CSRF token', async () => {
    mockPost.mockResolvedValue({
      data: {
        memberId: 2,
        email: 'new@fix.com',
        name: 'New User',
      },
    });

    await expect(
      registerMember({
        password: 'Test1234!',
        email: 'new@fix.com',
        name: 'New User',
      }),
    ).resolves.toEqual({
      memberUuid: '2',
      email: 'new@fix.com',
      name: 'New User',
      role: 'ROLE_USER',
      totpEnrolled: false,
    });

    const [url, body, options] = mockPost.mock.calls[0] ?? [];
    expect(url).toBe('/api/v1/auth/register');
    expect(body).toBeInstanceOf(URLSearchParams);
    expect((body as URLSearchParams).toString()).toBe(
      'email=new%40fix.com&password=Test1234%21&name=New+User',
    );
    expect(options).toEqual({
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      _skipAuthHandling: true,
    });
    expect(mockClearCsrfToken).toHaveBeenCalledTimes(1);
  });

  it('verifies the submitted OTP and refreshes CSRF for the authenticated session', async () => {
    mockPost.mockResolvedValue({
      data: {
        memberId: 1,
        email: 'demo@fix.com',
        name: 'Demo User',
        totpEnrolled: true,
      },
    });
    mockFetchCsrfToken.mockResolvedValue({
      csrfToken: 'csrf-token',
      headerName: 'X-CSRF-TOKEN',
    });

    await expect(
      verifyLoginOtp({
        loginToken: 'login-token',
        otpCode: '123456',
      }),
    ).resolves.toEqual({
      memberUuid: '1',
      email: 'demo@fix.com',
      name: 'Demo User',
      role: 'ROLE_USER',
      totpEnrolled: true,
      accountId: undefined,
    });

    expect(mockPost).toHaveBeenCalledWith(
      '/api/v1/auth/otp/verify',
      {
        loginToken: 'login-token',
        otpCode: '123456',
      },
      {
        _skipAuthHandling: true,
      },
    );
    expect(mockFetchCsrfToken).toHaveBeenCalledWith(true);
  });

  it('bootstraps TOTP enrollment with the pending login token', async () => {
    mockPost.mockResolvedValue({
      data: {
        qrUri: 'otpauth://totp/FIX:demo@fix.com?secret=ABC123',
        manualEntryKey: 'ABC123',
        enrollmentToken: 'enrollment-token',
        expiresAt: '2026-03-12T10:05:00Z',
      },
    });

    await expect(
      beginTotpEnrollment({
        loginToken: 'login-token',
      }),
    ).resolves.toEqual({
      qrUri: 'otpauth://totp/FIX:demo@fix.com?secret=ABC123',
      manualEntryKey: 'ABC123',
      enrollmentToken: 'enrollment-token',
      expiresAt: '2026-03-12T10:05:00Z',
    });

    expect(mockPost).toHaveBeenCalledWith(
      '/api/v1/members/me/totp/enroll',
      {
        loginToken: 'login-token',
      },
      {
        _skipAuthHandling: true,
      },
    );
  });

  it('confirms TOTP enrollment and refreshes CSRF for the new authenticated session', async () => {
    mockPost.mockResolvedValue({
      data: {
        memberId: 1,
        email: 'demo@fix.com',
        name: 'Demo User',
        totpEnrolled: true,
      },
    });
    mockFetchCsrfToken.mockResolvedValue({
      csrfToken: 'csrf-token',
      headerName: 'X-CSRF-TOKEN',
    });

    await expect(
      confirmTotpEnrollment({
        loginToken: 'login-token',
        enrollmentToken: 'enrollment-token',
        otpCode: '123456',
      }),
    ).resolves.toEqual({
      memberUuid: '1',
      email: 'demo@fix.com',
      name: 'Demo User',
      role: 'ROLE_USER',
      totpEnrolled: true,
      accountId: undefined,
    });

    expect(mockPost).toHaveBeenCalledWith(
      '/api/v1/members/me/totp/confirm',
      {
        loginToken: 'login-token',
        enrollmentToken: 'enrollment-token',
        otpCode: '123456',
      },
      {
        _skipAuthHandling: true,
      },
    );
    expect(mockFetchCsrfToken).toHaveBeenCalledWith(true);
  });

  it('submits the forgot-password request as a JSON body', async () => {
    mockPost.mockResolvedValue({
      data: {
        accepted: true,
        message: 'If the account is eligible, a reset email will be sent.',
        recovery: {
          challengeEndpoint: '/api/v1/auth/password/forgot/challenge',
          challengeMayBeRequired: true,
        },
      },
    });

    await expect(
      requestPasswordResetEmail({
        email: 'demo@fix.com',
      }),
    ).resolves.toEqual({
      accepted: true,
      message: 'If the account is eligible, a reset email will be sent.',
      recovery: {
        challengeEndpoint: '/api/v1/auth/password/forgot/challenge',
        challengeMayBeRequired: true,
      },
    });

    expect(mockPost).toHaveBeenCalledWith(
      '/api/v1/auth/password/forgot',
      {
        email: 'demo@fix.com',
      },
      {
        _skipAuthHandling: true,
      },
    );
  });

  it('bootstraps a password-recovery challenge as a JSON body', async () => {
    mockPost.mockResolvedValue({
      data: {
        challengeToken: 'challenge-token',
        challengeType: 'captcha',
        challengeTtlSeconds: 300,
      },
    });

    await expect(
      requestPasswordRecoveryChallenge({
        email: 'demo@fix.com',
      }),
    ).resolves.toEqual({
      challengeToken: 'challenge-token',
      challengeType: 'captcha',
      challengeTtlSeconds: 300,
    });

    expect(mockPost).toHaveBeenCalledWith(
      '/api/v1/auth/password/forgot/challenge',
      {
        email: 'demo@fix.com',
      },
      {
        _skipAuthHandling: true,
      },
    );
  });

  it('submits the password reset payload as JSON and returns empty recovery continuation by default', async () => {
    mockPost.mockResolvedValue({
      status: 204,
      data: null,
      headers: {},
    });

    await expect(
      resetPassword({
        token: 'reset-token',
        newPassword: 'Test1234!',
      }),
    ).resolves.toEqual({
      recoveryProof: undefined,
      recoveryProofExpiresInSeconds: undefined,
    });

    expect(mockPost).toHaveBeenCalledWith(
      '/api/v1/auth/password/reset',
      {
        token: 'reset-token',
        newPassword: 'Test1234!',
      },
      {
        _skipAuthHandling: true,
      },
    );
  });

  it('returns MFA recovery continuation when the password reset response includes proof headers', async () => {
    mockPost.mockResolvedValue({
      status: 204,
      data: null,
      headers: {
        'x-mfa-recovery-proof': 'recovery-proof-token',
        'x-mfa-recovery-proof-expires-in': '600',
      },
    });

    await expect(
      resetPassword({
        token: 'reset-token',
        newPassword: 'Test1234!',
      }),
    ).resolves.toEqual({
      recoveryProof: 'recovery-proof-token',
      recoveryProofExpiresInSeconds: 600,
    });
  });

  it('bootstraps authenticated TOTP rebind as JSON', async () => {
    mockPost.mockResolvedValue({
      data: {
        rebindToken: 'rebind-token',
        qrUri: 'otpauth://totp/FIX:demo@fix.com?secret=ABC123',
        manualEntryKey: 'ABC123',
        enrollmentToken: 'enrollment-token',
        expiresAt: '2026-03-12T10:05:00Z',
      },
    });

    await expect(
      bootstrapAuthenticatedTotpRebind({
        currentPassword: 'Test1234!',
      }),
    ).resolves.toEqual({
      rebindToken: 'rebind-token',
      qrUri: 'otpauth://totp/FIX:demo@fix.com?secret=ABC123',
      manualEntryKey: 'ABC123',
      enrollmentToken: 'enrollment-token',
      expiresAt: '2026-03-12T10:05:00Z',
    });

    expect(mockPost).toHaveBeenCalledWith(
      '/api/v1/members/me/totp/rebind',
      {
        currentPassword: 'Test1234!',
      },
      {
        _skipAuthHandling: true,
      },
    );
  });

  it('bootstraps recovery-driven TOTP rebind as JSON', async () => {
    mockPost.mockResolvedValue({
      data: {
        rebindToken: 'rebind-token',
        qrUri: 'otpauth://totp/FIX:demo@fix.com?secret=ABC123',
        manualEntryKey: 'ABC123',
        enrollmentToken: 'enrollment-token',
        expiresAt: '2026-03-12T10:05:00Z',
      },
    });

    await expect(
      bootstrapRecoveryTotpRebind({
        recoveryProof: 'recovery-proof-token',
      }),
    ).resolves.toEqual({
      rebindToken: 'rebind-token',
      qrUri: 'otpauth://totp/FIX:demo@fix.com?secret=ABC123',
      manualEntryKey: 'ABC123',
      enrollmentToken: 'enrollment-token',
      expiresAt: '2026-03-12T10:05:00Z',
    });

    expect(mockPost).toHaveBeenCalledWith(
      '/api/v1/auth/mfa-recovery/rebind',
      {
        recoveryProof: 'recovery-proof-token',
      },
      {
        _skipAuthHandling: true,
      },
    );
  });

  it('confirms MFA recovery rebind as JSON', async () => {
    mockPost.mockResolvedValue({
      data: {
        rebindCompleted: true,
        reauthRequired: true,
      },
    });

    await expect(
      confirmMfaRecoveryRebind({
        rebindToken: 'rebind-token',
        enrollmentToken: 'enrollment-token',
        otpCode: '123456',
      }),
    ).resolves.toEqual({
      rebindCompleted: true,
      reauthRequired: true,
    });

    expect(mockPost).toHaveBeenCalledWith(
      '/api/v1/auth/mfa-recovery/rebind/confirm',
      {
        rebindToken: 'rebind-token',
        enrollmentToken: 'enrollment-token',
        otpCode: '123456',
      },
      {
        _skipAuthHandling: true,
      },
    );
    expect(mockClearCsrfToken).toHaveBeenCalledTimes(1);
    expect(mockFetchCsrfToken).toHaveBeenCalledWith(true);
  });

  it('does not mask a successful MFA recovery rebind when csrf bootstrap refresh fails', async () => {
    mockPost.mockResolvedValue({
      data: {
        rebindCompleted: true,
        reauthRequired: true,
      },
    });
    mockFetchCsrfToken.mockRejectedValue(new Error('csrf bootstrap unavailable'));

    await expect(
      confirmMfaRecoveryRebind({
        rebindToken: 'rebind-token',
        enrollmentToken: 'enrollment-token',
        otpCode: '123456',
      }),
    ).resolves.toEqual({
      rebindCompleted: true,
      reauthRequired: true,
    });

    expect(mockClearCsrfToken).toHaveBeenCalledTimes(1);
    expect(mockFetchCsrfToken).toHaveBeenCalledWith(true);
  });
});
