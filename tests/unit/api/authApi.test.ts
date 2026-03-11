import {
  fetchSession,
  loginMember,
  requestPasswordRecoveryChallenge,
  requestPasswordResetEmail,
  registerMember,
  resetPassword,
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
  accountId: 'ACC-001',
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

  it('logs in a member and refreshes the CSRF token for subsequent requests', async () => {
    mockPost.mockResolvedValue({
      data: {
        memberId: 1,
        email: 'demo@fix.com',
        name: 'Demo User',
      },
    });
    mockGet.mockResolvedValue({ data: memberFixture });
    mockFetchCsrfToken.mockResolvedValue({
      csrfToken: 'csrf-token',
      headerName: 'X-CSRF-TOKEN',
    });

    await expect(
      loginMember({ email: 'demo@fix.com', password: 'Test1234!' }),
    ).resolves.toEqual(memberFixture);

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
    expect(mockFetchCsrfToken).toHaveBeenCalledWith(true);
    expect(mockGet).toHaveBeenCalledWith('/api/v1/auth/session', {
      _skipAuthHandling: true,
    });
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

  it('submits the password reset payload as JSON and resolves without a body', async () => {
    mockPost.mockResolvedValue({
      status: 204,
      data: null,
    });

    await expect(
      resetPassword({
        token: 'reset-token',
        newPassword: 'Test1234!',
      }),
    ).resolves.toBeUndefined();

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
});
