import { fetchSession, loginMember, registerMember } from '@/api/authApi';
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
  username: 'demo',
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
    mockPost.mockResolvedValue({ data: memberFixture });
    mockFetchCsrfToken.mockResolvedValue({
      csrfToken: 'csrf-token',
      headerName: 'X-CSRF-TOKEN',
    });

    await expect(
      loginMember({ username: 'demo', password: 'Test1234!' }),
    ).resolves.toEqual(memberFixture);

    expect(mockPost).toHaveBeenCalledWith(
      '/api/v1/auth/login',
      { username: 'demo', password: 'Test1234!' },
      { _skipAuthHandling: true },
    );
    expect(mockFetchCsrfToken).toHaveBeenCalledWith(true);
  });

  it('registers a member and clears the cached CSRF token', async () => {
    mockPost.mockResolvedValue({ data: memberFixture });

    await expect(
      registerMember({
        username: 'new_user',
        password: 'Test1234!',
        email: 'new@fix.com',
        name: 'New User',
      }),
    ).resolves.toEqual(memberFixture);

    expect(mockPost).toHaveBeenCalledWith(
      '/api/v1/auth/register',
      {
        username: 'new_user',
        password: 'Test1234!',
        email: 'new@fix.com',
        name: 'New User',
      },
      { _skipAuthHandling: true },
    );
    expect(mockClearCsrfToken).toHaveBeenCalledTimes(1);
  });
});
