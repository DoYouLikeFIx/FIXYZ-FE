import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import App from '@/App';
import type { NormalizedApiError } from '@/lib/axios';
import { resetAuthStore } from '@/store/useAuthStore';
import type { Member } from '@/types/auth';

const mockFetchSession = vi.fn();
const mockLoginMember = vi.fn();
const mockRegisterMember = vi.fn();
const mockRequestPasswordResetEmail = vi.fn();
const mockRequestPasswordRecoveryChallenge = vi.fn();
const mockResetPassword = vi.fn();

vi.mock('@/api/authApi', () => ({
  fetchSession: () => mockFetchSession(),
  loginMember: (payload: unknown) => mockLoginMember(payload),
  registerMember: (payload: unknown) => mockRegisterMember(payload),
  requestPasswordResetEmail: (payload: unknown) => mockRequestPasswordResetEmail(payload),
  requestPasswordRecoveryChallenge: (payload: unknown) =>
    mockRequestPasswordRecoveryChallenge(payload),
  resetPassword: (payload: unknown) => mockResetPassword(payload),
}));

class MockEventSource {
  static instances: MockEventSource[] = [];

  readonly listeners = new Map<string, Set<(event: MessageEvent) => void>>();

  onerror: ((event: Event) => void) | null = null;

  closed = false;

  constructor(
    public readonly url: string,
    public readonly init?: EventSourceInit,
  ) {
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    const wrapped = listener as (event: MessageEvent) => void;
    const handlers = this.listeners.get(type) ?? new Set();
    handlers.add(wrapped);
    this.listeners.set(type, handlers);
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    this.listeners.get(type)?.delete(listener as (event: MessageEvent) => void);
  }

  close() {
    this.closed = true;
  }

  emit(type: string, payload: unknown) {
    const event = new MessageEvent(type, {
      data: JSON.stringify(payload),
    });

    this.listeners.get(type)?.forEach((listener) => listener(event));
  }
}

const memberFixture: Member = {
  memberUuid: 'member-001',
  email: 'demo@fix.com',
  name: 'Demo User',
  role: 'ROLE_USER',
  totpEnrolled: true,
  accountId: 'ACC-001',
};

const createApiError = (
  overrides: Partial<NormalizedApiError> & { message?: string } = {},
): NormalizedApiError => {
  const error = new Error(
    overrides.message ?? 'Unexpected server response. Please try again.',
  ) as NormalizedApiError;

  error.name = 'ApiClientError';
  error.code = overrides.code;
  error.status = overrides.status;
  error.detail = overrides.detail;
  error.traceId = overrides.traceId;

  return error;
};

const createDeferred = <T,>() => {
  let resolvePromise!: (value: T | PromiseLike<T>) => void;
  let rejectPromise!: (reason?: unknown) => void;

  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });

  return {
    promise,
    resolve: resolvePromise,
    reject: rejectPromise,
  };
};

describe('App auth flow', () => {
  beforeAll(() => {
    vi.stubGlobal('EventSource', MockEventSource);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    mockFetchSession.mockReset();
    mockLoginMember.mockReset();
    mockRegisterMember.mockReset();
    mockRequestPasswordResetEmail.mockReset();
    mockRequestPasswordRecoveryChallenge.mockReset();
    mockResetPassword.mockReset();
    MockEventSource.instances = [];
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

  it('redirects unauthenticated private-route access to login with the intended destination', async () => {
    window.history.pushState({}, '', '/portfolio?tab=positions');

    render(<App />);

    expect(
      await screen.findByRole('heading', { name: /FIX 플랫폼에 오신 것을/i }),
    ).toBeInTheDocument();
    expect(window.location.pathname).toBe('/login');
    expect(window.location.search).toContain(
      'redirect=%2Fportfolio%3Ftab%3Dpositions',
    );
  });

  it('holds public auth routes on a checking shell until the bootstrap session request settles', async () => {
    const deferred = createDeferred<Member>();
    mockFetchSession.mockReturnValue(deferred.promise);

    render(<App />);

    expect(
      screen.getByRole('heading', { name: '보안 세션을 확인하고 있습니다' }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('login-email')).not.toBeInTheDocument();

    await act(async () => {
      deferred.reject(
        createApiError({
          code: 'AUTH-003',
          status: 401,
          message: 'Authentication required',
        }),
      );
      await Promise.resolve();
    });

    expect(
      await screen.findByRole('heading', { name: /FIX 플랫폼에 오신 것을/i }),
    ).toBeInTheDocument();
  });

  it('navigates to the protected area after successful login', async () => {
    mockLoginMember.mockResolvedValue(memberFixture);
    const user = userEvent.setup();

    render(<App />);

    await user.type(await screen.findByTestId('login-email'), 'demo@fix.com');
    await user.type(screen.getByTestId('login-password'), 'Test1234!');
    await user.click(screen.getByTestId('login-submit'));

    expect(mockLoginMember).toHaveBeenCalledWith({
      email: 'demo@fix.com',
      password: 'Test1234!',
    });
    expect(await screen.findByTestId('protected-area-title')).toHaveTextContent(
      'Portfolio overview',
    );
    expect(window.location.pathname).toBe('/portfolio');
  });

  it('restores the original protected destination after login succeeds', async () => {
    mockLoginMember.mockResolvedValue(memberFixture);
    const user = userEvent.setup();

    window.history.pushState({}, '', '/portfolio?tab=positions#open-orders');
    render(<App />);

    expect(
      await screen.findByRole('heading', { name: /FIX 플랫폼에 오신 것을/i }),
    ).toBeInTheDocument();
    expect(window.location.pathname).toBe('/login');
    expect(window.location.search).toContain(
      'redirect=%2Fportfolio%3Ftab%3Dpositions%23open-orders',
    );

    await user.type(screen.getByLabelText('이메일'), 'demo@fix.com');
    await user.type(screen.getByLabelText('비밀번호'), 'Test1234!');
    await user.click(screen.getByRole('button', { name: '로그인' }));

    expect(await screen.findByTestId('protected-area-title')).toHaveTextContent(
      'Portfolio overview',
    );
    expect(window.location.pathname).toBe('/portfolio');
    expect(window.location.search).toBe('?tab=positions');
    expect(window.location.hash).toBe('#open-orders');
  });

  it('sanitizes auth-page redirect targets to avoid redirect loops for authenticated members', async () => {
    mockFetchSession.mockResolvedValue(memberFixture);

    window.history.pushState({}, '', '/login?redirect=/login');
    render(<App />);

    expect(await screen.findByTestId('protected-area-title')).toHaveTextContent(
      'Portfolio overview',
    );
    expect(window.location.pathname).toBe('/portfolio');
    expect(window.location.search).toBe('');
  });

  it('shows canonical login and register fields for the current contract', async () => {
    const loginView = render(<App />);

    expect(await screen.findByTestId('login-email')).toHaveAttribute(
      'placeholder',
      '이메일',
    );
    expect(screen.getByTestId('login-password')).toBeInTheDocument();

    loginView.unmount();

    act(() => {
      window.history.pushState({}, '', '/register');
    });
    render(<App />);

    expect(await screen.findByTestId('register-email')).toBeInTheDocument();
    expect(
      screen.getByText('로그인과 비밀번호 재설정에 같은 이메일을 사용합니다.'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('register-name')).toBeInTheDocument();
    expect(screen.getByTestId('register-password')).toBeInTheDocument();
    expect(screen.getByTestId('register-password-confirm')).toBeInTheDocument();
  });

  it('shows email-based password recovery guidance from the login form', async () => {
    const user = userEvent.setup();

    render(<App />);

    await user.type(await screen.findByLabelText('이메일'), 'demo@fix.com');
    await user.click(screen.getByTestId('login-password-recovery-toggle'));

    expect(screen.getByTestId('login-password-recovery-help')).toHaveTextContent(
      '비밀번호 재설정은 가입한 이메일 기준으로 진행됩니다.',
    );
    expect(screen.getByTestId('login-password-recovery-help')).toHaveTextContent(
      '현재 입력된 이메일: demo@fix.com',
    );

    await user.click(screen.getByTestId('login-password-recovery-toggle'));

    expect(
      screen.queryByTestId('login-password-recovery-help'),
    ).not.toBeInTheDocument();
  });

  it('updates portfolio selections interactively after authentication succeeds', async () => {
    mockFetchSession.mockResolvedValue(memberFixture);
    const user = userEvent.setup();

    window.history.pushState({}, '', '/portfolio');
    render(<App />);

    expect(await screen.findByTestId('protected-area-title')).toHaveTextContent(
      'Portfolio overview',
    );
    expect(await screen.findByTestId('portfolio-selected-holding')).toHaveTextContent(
      '비트코인',
    );
    expect(screen.getByTestId('portfolio-selected-range')).toHaveTextContent('1M');
    expect(screen.getByTestId('portfolio-selected-watch')).toHaveTextContent(
      'SK하이닉스',
    );

    await user.click(screen.getByTestId('portfolio-range-1Y'));
    await user.click(screen.getByTestId('portfolio-holding-sol'));
    await user.click(screen.getByTestId('portfolio-watch-tesla'));
    await user.click(screen.getByTestId('portfolio-profile-공격형'));

    expect(screen.getByTestId('portfolio-selected-range')).toHaveTextContent('1Y');
    expect(screen.getByTestId('portfolio-selected-holding')).toHaveTextContent(
      '솔라나',
    );
    expect(screen.getByTestId('portfolio-position-thesis')).toHaveTextContent(
      '체인 활동성과 디앱 사용량이 높아져',
    );
    expect(screen.getByTestId('portfolio-selected-watch')).toHaveTextContent(
      'Tesla',
    );
    expect(screen.getByText('변동성 플레이 대상으로 가장 빠르게 반응합니다.')).toBeInTheDocument();
    expect(screen.getByTestId('portfolio-demo-order')).toBeDisabled();
  });

  it('registers a member and completes the post-register login flow', async () => {
    mockRegisterMember.mockResolvedValue({
      ...memberFixture,
      totpEnrolled: false,
    });
    mockLoginMember.mockResolvedValue({
      ...memberFixture,
      totpEnrolled: false,
    });
    const user = userEvent.setup();

    window.history.pushState({}, '', '/register');
    render(<App />);

    await user.type(await screen.findByTestId('register-email'), 'new@fix.com');
    await user.type(screen.getByTestId('register-name'), 'New User');
    await user.type(screen.getByTestId('register-password'), 'Test1234!');
    await user.type(
      screen.getByTestId('register-password-confirm'),
      'Test1234!',
    );
    await user.click(screen.getByTestId('register-submit'));

    expect(mockRegisterMember).toHaveBeenCalledWith({
      password: 'Test1234!',
      email: 'new@fix.com',
      name: 'New User',
    });
    expect(mockLoginMember).toHaveBeenCalledWith({
      email: 'new@fix.com',
      password: 'Test1234!',
    });
    expect(await screen.findByTestId('protected-area-title')).toHaveTextContent(
      'Portfolio overview',
    );
  });

  it('renders the standardized register error message once when the email is already taken', async () => {
    mockRegisterMember.mockRejectedValue(
      createApiError({
        code: 'AUTH-017',
        status: 409,
        message: 'Email already exists',
      }),
    );
    const user = userEvent.setup();

    window.history.pushState({}, '', '/register');
    render(<App />);

    await user.type(await screen.findByLabelText('이메일'), 'new@fix.com');
    await user.type(screen.getByLabelText('이름'), 'New User');
    await user.type(screen.getByLabelText('비밀번호'), 'Test1234!');
    await user.type(screen.getByLabelText('비밀번호 확인'), 'Test1234!');
    await user.click(screen.getByRole('button', { name: '회원가입' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '이미 가입된 이메일입니다. 다른 이메일을 입력해 주세요.',
    );
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(mockLoginMember).not.toHaveBeenCalled();
  });

  it('renders the standardized auth error message when login fails', async () => {
    mockLoginMember.mockRejectedValue(
      createApiError({
        code: 'AUTH-001',
        status: 401,
        message: 'Credential mismatch',
      }),
    );
    const user = userEvent.setup();

    render(<App />);

    await user.type(await screen.findByTestId('login-email'), 'demo@fix.com');
    await user.type(screen.getByTestId('login-password'), 'wrong-password');
    await user.click(screen.getByTestId('login-submit'));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '이메일 또는 비밀번호가 올바르지 않습니다.',
    );
    expect(screen.getAllByRole('alert')).toHaveLength(1);
  });

  it.each([
    ['AUTH-002', '로그인 시도가 잠겨 있습니다. 잠시 후 다시 시도해 주세요.'],
    ['RATE-001', '로그인 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.'],
  ])(
    'renders the standardized login recovery guidance for %s',
    async (code, expectedMessage) => {
      mockLoginMember.mockRejectedValue(
        createApiError({
          code,
          status: code === 'RATE-001' ? 429 : 401,
          message: `${code} backend message`,
        }),
      );
      const user = userEvent.setup();

      render(<App />);

      await user.type(await screen.findByTestId('login-email'), 'demo@fix.com');
      await user.type(screen.getByTestId('login-password'), 'wrong-password');
      await user.click(screen.getByTestId('login-submit'));

      expect(await screen.findByRole('alert')).toHaveTextContent(expectedMessage);
      expect(screen.getAllByRole('alert')).toHaveLength(1);
    },
  );

  it('shows the safe fallback and visible correlation id for unknown auth codes', async () => {
    mockLoginMember.mockRejectedValue(
      createApiError({
        code: 'AUTH-999',
        status: 500,
        message: 'Internal backend details should not leak',
        traceId: 'corr-123',
      }),
    );
    const user = userEvent.setup();

    render(<App />);

    await user.type(await screen.findByTestId('login-email'), 'demo@fix.com');
    await user.type(screen.getByTestId('login-password'), 'wrong-password');
    await user.click(screen.getByTestId('login-submit'));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '로그인을 완료할 수 없습니다. 잠시 후 다시 시도해 주세요. 문제가 계속되면 고객센터에 문의해 주세요. 문의 코드: corr-123',
    );
  });

  it('shows a custom inline login validation error instead of relying on browser popups', async () => {
    const user = userEvent.setup();

    render(<App />);

    await user.type(await screen.findByTestId('login-email'), 'demo@fix.com');
    await user.click(screen.getByTestId('login-submit'));

    expect(await screen.findByTestId('error-message')).toHaveTextContent(
      '비밀번호를 입력해 주세요.',
    );
    expect(mockLoginMember).not.toHaveBeenCalled();
  });

  it('keeps register password visibility toggles independent', async () => {
    const user = userEvent.setup();

    window.history.pushState({}, '', '/register');
    render(<App />);

    const passwordInput = await screen.findByTestId('register-password');
    const confirmInput = screen.getByTestId('register-password-confirm');

    expect(passwordInput).toHaveAttribute('type', 'password');
    expect(confirmInput).toHaveAttribute('type', 'password');

    await user.click(screen.getByTestId('register-password-toggle'));

    expect(passwordInput).toHaveAttribute('type', 'text');
    expect(confirmInput).toHaveAttribute('type', 'password');

    await user.click(screen.getByTestId('register-password-confirm-toggle'));

    expect(passwordInput).toHaveAttribute('type', 'text');
    expect(confirmInput).toHaveAttribute('type', 'text');
  });

  it('shows password policy validation and keeps register submit clickable until valid', async () => {
    const user = userEvent.setup();

    window.history.pushState({}, '', '/register');
    render(<App />);

    await user.type(await screen.findByTestId('register-password'), 'short');

    expect(screen.getByTestId('register-submit')).toBeEnabled();
    expect(screen.getByTestId('register-password-match-status')).toHaveTextContent(
      '비밀번호 확인을 입력해 주세요.',
    );

    await user.click(screen.getByTestId('register-submit'));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '이메일을 입력해 주세요.',
    );
    expect(mockRegisterMember).not.toHaveBeenCalled();

    await user.type(screen.getByTestId('register-password-confirm'), 'different');

    expect(screen.getByTestId('register-password-match-status')).toHaveTextContent(
      '비밀번호 확인이 일치하지 않습니다.',
    );
    expect(mockRegisterMember).not.toHaveBeenCalled();
  });

  it('shows session-expiry guidance and extends the session when the warning action succeeds', async () => {
    mockFetchSession.mockResolvedValue(memberFixture);
    const user = userEvent.setup();

    window.history.pushState({}, '', '/portfolio');
    render(<App />);

    expect(await screen.findByTestId('protected-area-title')).toHaveTextContent(
      'Portfolio overview',
    );

    const stream = MockEventSource.instances.at(-1);
    expect(stream).toBeDefined();

    act(() => {
      stream?.emit('session-expiry', { remainingSeconds: 300 });
    });

    expect(
      await screen.findByTestId('session-expiry-guidance'),
    ).toHaveTextContent('300');

    await user.click(screen.getByTestId('session-expiry-extend'));

    await waitFor(() => {
      expect(
        screen.queryByTestId('session-expiry-guidance'),
      ).not.toBeInTheDocument();
    });
  });

  it('redirects to login with re-auth guidance when session extension falls back to auth failure', async () => {
    mockFetchSession.mockResolvedValueOnce(memberFixture).mockRejectedValueOnce(
      createApiError({
        code: 'CHANNEL-001',
        status: 410,
        message: 'Redis session expired',
      }),
    );
    const user = userEvent.setup();

    window.history.pushState({}, '', '/portfolio');
    render(<App />);

    expect(await screen.findByTestId('protected-area-title')).toHaveTextContent(
      'Portfolio overview',
    );

    const stream = MockEventSource.instances.at(-1);
    expect(stream).toBeDefined();

    act(() => {
      stream?.emit('session-expiry', { remainingSeconds: 120 });
    });

    await user.click(await screen.findByTestId('session-expiry-extend'));

    expect(
      await screen.findByTestId('reauth-guidance'),
    ).toHaveTextContent('세션이 만료되었습니다. 다시 로그인해 주세요.');
    expect(window.location.pathname).toBe('/login');
  });

  it('redirects to login with preserved destination when the session was invalidated by a newer login', async () => {
    mockFetchSession.mockResolvedValueOnce(memberFixture).mockRejectedValueOnce(
      createApiError({
        code: 'AUTH-016',
        status: 401,
        message: 'Session invalidated by another login',
      }),
    );
    const user = userEvent.setup();

    window.history.pushState({}, '', '/portfolio?tab=positions#open-orders');
    render(<App />);

    expect(await screen.findByTestId('protected-area-title')).toHaveTextContent(
      'Portfolio overview',
    );

    const stream = MockEventSource.instances.at(-1);
    expect(stream).toBeDefined();

    act(() => {
      stream?.emit('session-expiry', { remainingSeconds: 90 });
    });

    await user.click(await screen.findByTestId('session-expiry-extend'));

    expect(
      await screen.findByTestId('reauth-guidance'),
    ).toHaveTextContent('세션이 만료되었습니다. 다시 로그인해 주세요.');
    expect(window.location.pathname).toBe('/login');
    expect(window.location.search).toContain(
      'redirect=%2Fportfolio%3Ftab%3Dpositions%23open-orders',
    );
  });

  it('keeps the protected view active and shows a retryable error when session extension fails for a non-reauth reason', async () => {
    mockFetchSession.mockResolvedValueOnce(memberFixture).mockRejectedValueOnce(
      createApiError({
        code: 'SYS-001',
        status: 503,
        message: 'Auth service unavailable',
      }),
    );
    const user = userEvent.setup();

    window.history.pushState({}, '', '/portfolio');
    render(<App />);

    expect(await screen.findByTestId('protected-area-title')).toHaveTextContent(
      'Portfolio overview',
    );

    const stream = MockEventSource.instances.at(-1);
    expect(stream).toBeDefined();

    act(() => {
      stream?.emit('session-expiry', { remainingSeconds: 45 });
    });

    await user.click(await screen.findByTestId('session-expiry-extend'));

    expect(await screen.findByTestId('session-expiry-error')).toHaveTextContent(
      '현재 인증 서비스를 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.',
    );
    expect(screen.getByTestId('session-expiry-guidance')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/portfolio');
    expect(screen.queryByTestId('reauth-guidance')).not.toBeInTheDocument();
  });

  it('reconnects the session-expiry stream after an error while the protected view stays mounted', async () => {
    mockFetchSession.mockResolvedValue(memberFixture);

    window.history.pushState({}, '', '/portfolio');
    render(<App />);

    expect(await screen.findByTestId('protected-area-title')).toHaveTextContent(
      'Portfolio overview',
    );

    vi.useFakeTimers();

    const originalStream = MockEventSource.instances.at(-1);
    expect(originalStream).toBeDefined();

    act(() => {
      originalStream?.onerror?.(new Event('error'));
    });

    expect(originalStream?.closed).toBe(true);
    expect(MockEventSource.instances).toHaveLength(1);

    act(() => {
      vi.advanceTimersByTime(3_000);
    });

    expect(MockEventSource.instances).toHaveLength(2);
    expect(MockEventSource.instances.at(-1)).not.toBe(originalStream);
  });

  it('cancels pending stream reconnect work when the protected view unmounts', async () => {
    mockFetchSession.mockResolvedValue(memberFixture);

    window.history.pushState({}, '', '/portfolio');
    const app = render(<App />);

    expect(await screen.findByTestId('protected-area-title')).toHaveTextContent(
      'Portfolio overview',
    );

    vi.useFakeTimers();

    const stream = MockEventSource.instances.at(-1);
    expect(stream).toBeDefined();

    act(() => {
      stream?.onerror?.(new Event('error'));
    });

    app.unmount();

    act(() => {
      vi.advanceTimersByTime(3_000);
    });

    expect(stream?.closed).toBe(true);
    expect(MockEventSource.instances).toHaveLength(1);
  });
});
