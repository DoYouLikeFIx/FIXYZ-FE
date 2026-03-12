import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import App from '@/App';
import type { NormalizedApiError } from '@/lib/axios';
import { resetAuthStore } from '@/store/useAuthStore';

const mockFetchSession = vi.fn();
const mockStartLoginFlow = vi.fn();
const mockVerifyLoginOtp = vi.fn();
const mockRegisterMember = vi.fn();
const mockBeginTotpEnrollment = vi.fn();
const mockConfirmTotpEnrollment = vi.fn();
const mockRequestPasswordResetEmail = vi.fn();
const mockRequestPasswordRecoveryChallenge = vi.fn();
const mockResetPassword = vi.fn();

vi.mock('@/api/authApi', () => ({
  fetchSession: () => mockFetchSession(),
  startLoginFlow: (payload: unknown) => mockStartLoginFlow(payload),
  verifyLoginOtp: (payload: unknown) => mockVerifyLoginOtp(payload),
  registerMember: (payload: unknown) => mockRegisterMember(payload),
  beginTotpEnrollment: (payload: unknown) => mockBeginTotpEnrollment(payload),
  confirmTotpEnrollment: (payload: unknown) => mockConfirmTotpEnrollment(payload),
  requestPasswordResetEmail: (payload: unknown) => mockRequestPasswordResetEmail(payload),
  requestPasswordRecoveryChallenge: (payload: unknown) =>
    mockRequestPasswordRecoveryChallenge(payload),
  resetPassword: (payload: unknown) => mockResetPassword(payload),
}));

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

  return error;
};

describe('password recovery routes', () => {
  beforeEach(() => {
    mockFetchSession.mockReset();
    mockStartLoginFlow.mockReset();
    mockVerifyLoginOtp.mockReset();
    mockRegisterMember.mockReset();
    mockBeginTotpEnrollment.mockReset();
    mockConfirmTotpEnrollment.mockReset();
    mockRequestPasswordResetEmail.mockReset();
    mockRequestPasswordRecoveryChallenge.mockReset();
    mockResetPassword.mockReset();
    resetAuthStore();
    window.history.pushState({}, '', '/login');
    mockFetchSession.mockRejectedValue(
      createApiError({
        code: 'AUTH-003',
        status: 401,
        message: 'Authentication required',
      }),
    );
  });

  it('opens the dedicated forgot-password route from login and preserves the typed email', async () => {
    const user = userEvent.setup();

    render(<App />);

    await user.type(await screen.findByTestId('login-email'), 'demo@fix.com');
    await user.click(screen.getByTestId('login-open-password-recovery'));

    await waitFor(() => {
      expect(window.location.pathname).toBe('/forgot-password');
    });
    expect(await screen.findByTestId('forgot-password-email')).toHaveValue('demo@fix.com');
  });

  it.each([
    'known@fix.com',
    'unknown@fix.com',
  ])('shows the same accepted copy for %s', async (email) => {
    const user = userEvent.setup();
    mockRequestPasswordResetEmail.mockResolvedValue({
      accepted: true,
      message: 'If the account is eligible, a reset email will be sent.',
      recovery: {
        challengeEndpoint: '/api/v1/auth/password/forgot/challenge',
        challengeMayBeRequired: true,
      },
    });

    window.history.pushState({}, '', '/forgot-password');
    render(<App />);

    await user.type(await screen.findByTestId('forgot-password-email'), email);
    await user.click(screen.getByTestId('forgot-password-submit'));

    expect(await screen.findByTestId('forgot-password-accepted')).toHaveTextContent(
      'If the account is eligible, a reset email will be sent.',
    );
  });

  it('stores challenge metadata and reuses the original email on the follow-up submit', async () => {
    const user = userEvent.setup();
    mockRequestPasswordRecoveryChallenge.mockResolvedValue({
      challengeToken: 'challenge-token',
      challengeType: 'captcha',
      challengeTtlSeconds: 300,
    });
    mockRequestPasswordResetEmail.mockResolvedValue({
      accepted: true,
      message: 'If the account is eligible, a reset email will be sent.',
      recovery: {
        challengeEndpoint: '/api/v1/auth/password/forgot/challenge',
        challengeMayBeRequired: true,
      },
    });

    window.history.pushState({}, '', '/forgot-password');
    render(<App />);

    await user.type(await screen.findByTestId('forgot-password-email'), 'demo@fix.com');
    await user.click(screen.getByTestId('forgot-password-submit'));
    expect(await screen.findByTestId('forgot-password-accepted')).toHaveTextContent(
      'If the account is eligible, a reset email will be sent.',
    );
    await user.click(screen.getByTestId('forgot-password-bootstrap-challenge'));

    expect(await screen.findByTestId('forgot-password-challenge-state')).toHaveTextContent(
      'captcha',
    );
    expect(screen.getByTestId('forgot-password-challenge-state')).toHaveTextContent(
      '300초',
    );

    await user.type(screen.getByTestId('forgot-password-challenge-answer'), 'ready');
    await user.click(screen.getByTestId('forgot-password-submit'));

    expect(mockRequestPasswordRecoveryChallenge).toHaveBeenCalledWith({
      email: 'demo@fix.com',
    });
    expect(mockRequestPasswordResetEmail).toHaveBeenCalledWith({
      email: 'demo@fix.com',
      challengeAnswer: 'ready',
      challengeToken: 'challenge-token',
    });
  });

  it('returns to login with deterministic success guidance after reset succeeds', async () => {
    const user = userEvent.setup();
    mockResetPassword.mockResolvedValue(undefined);

    window.history.pushState({}, '', '/reset-password?token=raw-reset-token');
    render(<App />);

    await user.type(
      await screen.findByTestId('reset-password-new-password'),
      'Test1234!',
    );
    await user.click(screen.getByTestId('reset-password-submit'));

    await waitFor(() => {
      expect(window.location.pathname).toBe('/login');
    });

    expect(mockResetPassword).toHaveBeenCalledWith({
      token: 'raw-reset-token',
      newPassword: 'Test1234!',
    });
    expect(await screen.findByTestId('password-reset-success')).toHaveTextContent(
      '비밀번호가 변경되었습니다. 새 비밀번호로 로그인해 주세요.',
    );
  });

  it('uses the latest token when the reset route receives a newer handoff in the same session', async () => {
    const user = userEvent.setup();
    mockResetPassword.mockResolvedValue(undefined);

    window.history.pushState({}, '', '/reset-password?token=first-token');
    render(<App />);

    await screen.findByTestId('reset-password-new-password');

    act(() => {
      window.history.pushState({}, '', '/reset-password?token=second-token');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });

    await waitFor(() => {
      expect(window.location.pathname).toBe('/reset-password');
    });

    await user.type(screen.getByTestId('reset-password-new-password'), 'Test1234!');
    await user.click(screen.getByTestId('reset-password-submit'));

    expect(mockResetPassword).toHaveBeenCalledWith({
      token: 'second-token',
      newPassword: 'Test1234!',
    });
  });

  it('shows deterministic invalid-token guidance when reset is rejected', async () => {
    const user = userEvent.setup();
    mockResetPassword.mockRejectedValue(
      createApiError({
        code: 'AUTH-012',
        status: 401,
        message: 'reset token invalid or expired',
      }),
    );

    window.history.pushState({}, '', '/reset-password?token=invalid-token');
    render(<App />);

    await user.type(
      await screen.findByTestId('reset-password-new-password'),
      'Test1234!',
    );
    await user.click(screen.getByTestId('reset-password-submit'));

    expect(await screen.findByTestId('reset-password-error')).toHaveTextContent(
      '재설정 링크가 유효하지 않거나 만료되었습니다. 비밀번호 재설정을 다시 요청해 주세요.',
    );
    expect(window.location.pathname).toBe('/reset-password');
  });

  it('clears stale accepted and challenge state when challenge replay is rejected', async () => {
    const user = userEvent.setup();
    mockRequestPasswordRecoveryChallenge.mockResolvedValue({
      challengeToken: 'challenge-token',
      challengeType: 'captcha',
      challengeTtlSeconds: 300,
    });
    mockRequestPasswordResetEmail
      .mockResolvedValueOnce({
        accepted: true,
        message: 'If the account is eligible, a reset email will be sent.',
        recovery: {
          challengeEndpoint: '/api/v1/auth/password/forgot/challenge',
          challengeMayBeRequired: true,
        },
      })
      .mockRejectedValueOnce(
        createApiError({
          code: 'AUTH-012',
          status: 401,
          message: 'challenge replay invalid or expired',
        }),
      );

    window.history.pushState({}, '', '/forgot-password');
    render(<App />);

    await user.type(await screen.findByTestId('forgot-password-email'), 'demo@fix.com');
    await user.click(screen.getByTestId('forgot-password-submit'));
    await user.click(await screen.findByTestId('forgot-password-bootstrap-challenge'));
    await user.type(await screen.findByTestId('forgot-password-challenge-answer'), 'ready');
    await user.click(screen.getByTestId('forgot-password-submit'));

    expect(await screen.findByTestId('forgot-password-error')).toHaveTextContent(
      '재설정 링크가 유효하지 않거나 만료되었습니다. 비밀번호 재설정을 다시 요청해 주세요.',
    );
    expect(screen.queryByTestId('forgot-password-accepted')).not.toBeInTheDocument();
    expect(screen.queryByTestId('forgot-password-challenge-state')).not.toBeInTheDocument();
    expect(screen.queryByTestId('forgot-password-bootstrap-challenge')).not.toBeInTheDocument();
  });

  it('clears stale challenge state when a challenged forgot submit is rate-limited', async () => {
    const user = userEvent.setup();
    mockRequestPasswordRecoveryChallenge.mockResolvedValue({
      challengeToken: 'challenge-token',
      challengeType: 'captcha',
      challengeTtlSeconds: 300,
    });
    mockRequestPasswordResetEmail
      .mockResolvedValueOnce({
        accepted: true,
        message: 'If the account is eligible, a reset email will be sent.',
        recovery: {
          challengeEndpoint: '/api/v1/auth/password/forgot/challenge',
          challengeMayBeRequired: true,
        },
      })
      .mockRejectedValueOnce(
        createApiError({
          code: 'AUTH-014',
          status: 429,
          retryAfterSeconds: 30,
          message: 'Too many password recovery attempts',
        }),
      );

    window.history.pushState({}, '', '/forgot-password');
    render(<App />);

    await user.type(await screen.findByTestId('forgot-password-email'), 'demo@fix.com');
    await user.click(screen.getByTestId('forgot-password-submit'));
    await user.click(await screen.findByTestId('forgot-password-bootstrap-challenge'));
    await user.type(await screen.findByTestId('forgot-password-challenge-answer'), 'ready');
    await user.click(screen.getByTestId('forgot-password-submit'));

    expect(await screen.findByTestId('forgot-password-error')).toHaveTextContent(
      '비밀번호 재설정 요청이 너무 많습니다. 30초 후 다시 시도해 주세요.',
    );
    expect(screen.queryByTestId('forgot-password-accepted')).not.toBeInTheDocument();
    expect(screen.queryByTestId('forgot-password-challenge-state')).not.toBeInTheDocument();
    expect(screen.queryByTestId('forgot-password-bootstrap-challenge')).not.toBeInTheDocument();
  });

  it('routes reset AUTH-016 outcomes back to login with re-auth guidance', async () => {
    const user = userEvent.setup();
    mockResetPassword.mockRejectedValue(
      createApiError({
        code: 'AUTH-016',
        status: 401,
        message: 'Session invalidated by another login',
      }),
    );

    window.history.pushState({}, '', '/reset-password?token=stale-token');
    render(<App />);

    await user.type(
      await screen.findByTestId('reset-password-new-password'),
      'Test1234!',
    );
    await user.click(screen.getByTestId('reset-password-submit'));

    await waitFor(() => {
      expect(window.location.pathname).toBe('/login');
    });
    expect(await screen.findByTestId('reauth-guidance')).toHaveTextContent(
      '세션이 만료되었습니다. 다시 로그인해 주세요.',
    );
  });

  it('only shows the reset-success banner for the actual recovery query key', async () => {
    window.history.pushState({}, '', '/login?note=recovery=reset-success');
    render(<App />);

    await screen.findByTestId('login-email');
    expect(screen.queryByTestId('password-reset-success')).not.toBeInTheDocument();
  });
});
