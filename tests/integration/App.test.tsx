import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import App from '@/App';
import type { NormalizedApiError } from '@/lib/axios';
import { resetAuthStore } from '@/store/useAuthStore';
import type {
  LoginChallenge,
  Member,
  TotpEnrollmentBootstrap,
} from '@/types/auth';

const mockFetchAccountPositions = vi.fn();
const mockFetchAccountSummary = vi.fn();
const mockFetchAccountOrderHistory = vi.fn();
const mockFetchSession = vi.fn();
const mockFetchNotifications = vi.fn();
const mockMarkNotificationRead = vi.fn();
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

vi.mock('@/api/accountApi', () => ({
  fetchAccountPositions: (payload: unknown) => mockFetchAccountPositions(payload),
  fetchAccountSummary: (payload: unknown) => mockFetchAccountSummary(payload),
  fetchAccountOrderHistory: (payload: unknown) => mockFetchAccountOrderHistory(payload),
}));

vi.mock('@/api/notificationApi', () => ({
  fetchNotifications: (cursorId?: number) => mockFetchNotifications(cursorId),
  markNotificationRead: (notificationId: number) => mockMarkNotificationRead(notificationId),
}));

class MockEventSource {
  static instances: MockEventSource[] = [];

  readonly listeners = new Map<string, Set<(event: MessageEvent) => void>>();

  onopen: ((event: Event) => void) | null = null;

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
  accountId: '1',
};

const loginChallengeFixture: LoginChallenge = {
  loginToken: 'login-token',
  nextAction: 'VERIFY_TOTP',
  totpEnrolled: true,
  expiresAt: '2026-03-12T10:00:00Z',
};

const enrollmentBootstrapFixture: TotpEnrollmentBootstrap = {
  qrUri: 'otpauth://totp/FIX:demo@fix.com?secret=ABC123',
  manualEntryKey: 'ABC123',
  enrollmentToken: 'enrollment-token',
  expiresAt: '2026-03-12T10:05:00Z',
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
  error.enrollUrl = overrides.enrollUrl;
  error.retryAfterSeconds = overrides.retryAfterSeconds;

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

const completeLoginMfaStep = async (
  user: ReturnType<typeof userEvent.setup>,
  otpCode = '123456',
) => {
  await user.type(await screen.findByTestId('login-mfa-input'), otpCode);
  await user.click(screen.getByTestId('login-mfa-submit'));
};

describe('App auth flow', () => {
  beforeAll(() => {
    vi.stubGlobal('EventSource', MockEventSource);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    mockFetchAccountPositions.mockReset();
    mockFetchAccountSummary.mockReset();
    mockFetchAccountOrderHistory.mockReset();
    mockFetchSession.mockReset();
    mockFetchNotifications.mockReset();
    mockMarkNotificationRead.mockReset();
    mockStartLoginFlow.mockReset();
    mockVerifyLoginOtp.mockReset();
    mockRegisterMember.mockReset();
    mockBeginTotpEnrollment.mockReset();
    mockConfirmTotpEnrollment.mockReset();
    mockRequestPasswordResetEmail.mockReset();
    mockRequestPasswordRecoveryChallenge.mockReset();
    mockResetPassword.mockReset();
    mockFetchAccountPositions.mockResolvedValue([
      {
        accountId: 1,
        memberId: 1,
        symbol: '005930',
        quantity: 120,
        availableQuantity: 20,
        availableQty: 20,
        balance: 100000000,
        availableBalance: 100000000,
        currency: 'KRW',
        asOf: '2026-03-11T09:10:00Z',
      },
      {
        accountId: 1,
        memberId: 1,
        symbol: '000660',
        quantity: 15,
        availableQuantity: 7,
        availableQty: 7,
        balance: 98500000,
        availableBalance: 98500000,
        currency: 'KRW',
        asOf: '2026-03-11T09:20:00Z',
      },
    ]);
    mockFetchAccountSummary.mockResolvedValue({
      accountId: 1,
      memberId: 1,
      symbol: '',
      quantity: 0,
      availableQuantity: 0,
      availableQty: 0,
      balance: 100000000,
      availableBalance: 100000000,
      currency: 'KRW',
      asOf: '2026-03-11T09:05:00Z',
    });
    mockFetchAccountOrderHistory.mockResolvedValue({
      content: [],
      totalElements: 0,
      totalPages: 0,
      number: 0,
      size: 10,
    });
    mockFetchNotifications.mockResolvedValue([]);
    mockMarkNotificationRead.mockImplementation((notificationId: number) => Promise.resolve({
      notificationId,
      channel: 'ORDER',
      message: 'Order notification',
      delivered: true,
      read: true,
      readAt: '2026-03-17T10:10:00Z',
    }));
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
    mockStartLoginFlow.mockResolvedValue(loginChallengeFixture);
    mockVerifyLoginOtp.mockResolvedValue(memberFixture);
    const user = userEvent.setup();

    render(<App />);

    await user.type(await screen.findByTestId('login-email'), 'demo@fix.com');
    await user.type(screen.getByTestId('login-password'), 'Test1234!');
    await user.click(screen.getByTestId('login-submit'));

    expect(mockStartLoginFlow).toHaveBeenCalledWith({
      email: 'demo@fix.com',
      password: 'Test1234!',
    });
    await completeLoginMfaStep(user);
    expect(mockVerifyLoginOtp).toHaveBeenCalledWith({
      loginToken: 'login-token',
      otpCode: '123456',
    });
    expect(await screen.findByTestId('protected-area-title')).toHaveTextContent(
      'Portfolio overview',
    );
    expect(window.location.pathname).toBe('/portfolio');
  });

  it('exposes the order boundary link from the protected portfolio page', async () => {
    mockStartLoginFlow.mockResolvedValue(loginChallengeFixture);
    mockVerifyLoginOtp.mockResolvedValue(memberFixture);
    const user = userEvent.setup();

    render(<App />);

    await user.type(await screen.findByTestId('login-email'), 'demo@fix.com');
    await user.type(screen.getByTestId('login-password'), 'Test1234!');
    await user.click(screen.getByTestId('login-submit'));
    await completeLoginMfaStep(user);

    expect(await screen.findByTestId('portfolio-demo-order')).toHaveAttribute(
      'href',
      '/orders',
    );
  });

  it('restores the original protected destination after login succeeds', async () => {
    mockStartLoginFlow.mockResolvedValue(loginChallengeFixture);
    mockVerifyLoginOtp.mockResolvedValue(memberFixture);
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
    await completeLoginMfaStep(user);

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

  it('updates the account dashboard interactively after authentication succeeds', async () => {
    mockFetchSession.mockResolvedValue(memberFixture);
    mockFetchAccountPositions.mockResolvedValue([
      {
        accountId: 1,
        memberId: 1,
        symbol: '005930',
        quantity: 120,
        availableQuantity: 20,
        availableQty: 20,
        balance: 100000000,
        availableBalance: 100000000,
        currency: 'KRW',
        asOf: '2026-03-11T09:10:00Z',
      },
      {
        accountId: 1,
        memberId: 1,
        symbol: '000660',
        quantity: 15,
        availableQuantity: 7,
        availableQty: 7,
        balance: 98500000,
        availableBalance: 98500000,
        currency: 'KRW',
        asOf: '2026-03-11T09:20:00Z',
      },
    ]);
    mockFetchAccountSummary.mockResolvedValue({
      accountId: 1,
      memberId: 1,
      symbol: '',
      quantity: 0,
      availableQuantity: 0,
      availableQty: 0,
      balance: 100000000,
      availableBalance: 100000000,
      currency: 'KRW',
      asOf: '2026-03-11T09:05:00Z',
    });
    mockFetchAccountOrderHistory.mockResolvedValue({
      content: [],
      totalElements: 0,
      totalPages: 0,
      number: 0,
      size: 10,
    });
    const user = userEvent.setup();

    window.history.pushState({}, '', '/portfolio');
    render(<App />);

    expect(await screen.findByTestId('protected-area-title')).toHaveTextContent(
      'Portfolio overview',
    );
    expect(await screen.findByTestId('portfolio-total-balance')).toHaveTextContent(
      '₩100,000,000',
    );
    expect(screen.getByTestId('portfolio-masked-account')).toHaveTextContent('***-***1');

    await user.click(screen.getByTestId('portfolio-symbol-000660'));

    await waitFor(() => {
      expect(mockFetchAccountPositions).toHaveBeenCalledWith({
        accountId: '1',
      });
    });
    expect(mockFetchAccountSummary).toHaveBeenCalledWith({
      accountId: '1',
    });
    expect(await screen.findByTestId('portfolio-available-quantity')).toHaveTextContent(
      '7주',
    );

    await user.click(screen.getByTestId('portfolio-tab-history'));

    expect(await screen.findByTestId('order-list-empty')).toHaveTextContent(
      '아직 주문 내역이 없습니다.',
    );
    expect(screen.getByTestId('portfolio-demo-order')).toHaveAttribute('href', '/orders');
  });

  it('registers a member and completes the post-register login flow', async () => {
    mockRegisterMember.mockResolvedValue({
      ...memberFixture,
      totpEnrolled: false,
    });
    mockStartLoginFlow.mockResolvedValue({
      loginToken: 'register-login-token',
      nextAction: 'ENROLL_TOTP',
      totpEnrolled: false,
      expiresAt: '2026-03-12T10:00:00Z',
    });
    mockBeginTotpEnrollment.mockResolvedValue({
      ...enrollmentBootstrapFixture,
      manualEntryKey: 'NEW123',
      qrUri: 'otpauth://totp/FIX:new@fix.com?secret=NEW123',
      enrollmentToken: 'register-enrollment-token',
    });
    mockConfirmTotpEnrollment.mockResolvedValue({
      ...memberFixture,
      email: 'new@fix.com',
      name: 'New User',
      totpEnrolled: true,
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
    expect(mockStartLoginFlow).toHaveBeenCalledWith({
      email: 'new@fix.com',
      password: 'Test1234!',
    });
    expect(await screen.findByTestId('totp-enroll-qr-image')).toBeInTheDocument();
    expect(await screen.findByTestId('totp-enroll-manual-key')).toHaveTextContent(
      'NEW123',
    );
    expect(screen.queryByText('otpauth://totp/FIX:new@fix.com?secret=NEW123')).not.toBeInTheDocument();
    await user.type(screen.getByTestId('totp-enroll-code'), '123456');
    await user.click(screen.getByTestId('totp-enroll-submit'));
    expect(mockBeginTotpEnrollment).toHaveBeenCalledWith({
      loginToken: 'register-login-token',
    });
    expect(mockConfirmTotpEnrollment).toHaveBeenCalledWith({
      loginToken: 'register-login-token',
      enrollmentToken: 'register-enrollment-token',
      otpCode: '123456',
    });
    expect(await screen.findByTestId('protected-area-title')).toHaveTextContent(
      'Portfolio overview',
    );
  });

  it('returns an unenrolled registered account to TOTP enrollment on a later login attempt', async () => {
    mockRegisterMember.mockResolvedValue({
      ...memberFixture,
      totpEnrolled: false,
    });
    mockStartLoginFlow
      .mockResolvedValueOnce({
        loginToken: 'register-login-token-1',
        nextAction: 'ENROLL_TOTP',
        totpEnrolled: false,
        expiresAt: '2026-03-12T10:00:00Z',
      })
      .mockResolvedValueOnce({
        loginToken: 'register-login-token-2',
        nextAction: 'ENROLL_TOTP',
        totpEnrolled: false,
        expiresAt: '2026-03-12T10:10:00Z',
      });
    mockBeginTotpEnrollment
      .mockResolvedValueOnce({
        ...enrollmentBootstrapFixture,
        manualEntryKey: 'FIRST123',
        qrUri: 'otpauth://totp/FIX:new@fix.com?secret=FIRST123',
        enrollmentToken: 'register-enrollment-token-1',
      })
      .mockResolvedValueOnce({
        ...enrollmentBootstrapFixture,
        manualEntryKey: 'SECOND456',
        qrUri: 'otpauth://totp/FIX:new@fix.com?secret=SECOND456',
        enrollmentToken: 'register-enrollment-token-2',
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

    expect(await screen.findByTestId('totp-enroll-manual-key')).toHaveTextContent(
      'FIRST123',
    );

    await user.click(screen.getByTestId('totp-enroll-reset'));

    expect(
      await screen.findByRole('heading', { name: /FIX 플랫폼에 오신 것을/i }),
    ).toBeInTheDocument();

    await user.type(screen.getByTestId('login-email'), 'new@fix.com');
    await user.type(screen.getByTestId('login-password'), 'Test1234!');
    await user.click(screen.getByTestId('login-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('totp-enroll-manual-key')).toHaveTextContent(
        'SECOND456',
      );
    });
    expect(mockStartLoginFlow).toHaveBeenCalledTimes(2);
    expect(mockBeginTotpEnrollment).toHaveBeenNthCalledWith(1, {
      loginToken: 'register-login-token-1',
    });
    expect(mockBeginTotpEnrollment).toHaveBeenNthCalledWith(2, {
      loginToken: 'register-login-token-2',
    });
  });

  it('preserves redirect query when the enrollment route is re-entered without pending MFA state', async () => {
    window.history.pushState(
      {},
      '',
      '/settings/totp/enroll?redirect=%2Fportfolio%3Ftab%3Dpositions%23open-orders',
    );

    render(<App />);

    expect(
      await screen.findByRole('heading', { name: /FIX 플랫폼에 오신 것을/i }),
    ).toBeInTheDocument();
    expect(window.location.pathname).toBe('/login');
    expect(window.location.search).toContain(
      'redirect=%2Fportfolio%3Ftab%3Dpositions%23open-orders',
    );
  });

  it('returns authenticated users on the enrollment route to the requested protected destination', async () => {
    mockFetchSession.mockResolvedValue(memberFixture);

    window.history.pushState(
      {},
      '',
      '/settings/totp/enroll?redirect=%2Forders',
    );

    render(<App />);

    expect(await screen.findByTestId('protected-area-title')).toHaveTextContent(
      'Session-based order flow',
    );
    expect(window.location.pathname).toBe('/orders');
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
    expect(mockStartLoginFlow).not.toHaveBeenCalled();
  });

  it('renders the standardized auth error message when login fails', async () => {
    mockStartLoginFlow.mockRejectedValue(
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
      mockStartLoginFlow.mockRejectedValue(
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

  it('ignores unsafe enrollment redirects returned by the MFA error contract', async () => {
    mockStartLoginFlow.mockResolvedValue(loginChallengeFixture);
    mockBeginTotpEnrollment.mockResolvedValue(enrollmentBootstrapFixture);
    mockVerifyLoginOtp.mockRejectedValue(
      createApiError({
        code: 'AUTH-009',
        status: 403,
        message: 'TOTP enrollment required',
        enrollUrl: 'https://evil.example/settings/totp/enroll',
      }),
    );
    const user = userEvent.setup();

    render(<App />);

    await user.type(await screen.findByTestId('login-email'), 'demo@fix.com');
    await user.type(screen.getByTestId('login-password'), 'Test1234!');
    await user.click(screen.getByTestId('login-submit'));
    await user.type(await screen.findByTestId('login-mfa-input'), '123456');
    await user.click(screen.getByTestId('login-mfa-submit'));

    expect(window.location.pathname).toBe('/settings/totp/enroll');
    expect(window.location.search).toContain('redirect=%2Fportfolio');
  });

  it('shows the safe fallback and visible correlation id for unknown auth codes', async () => {
    mockStartLoginFlow.mockRejectedValue(
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
    expect(mockStartLoginFlow).not.toHaveBeenCalled();
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

  it('establishes a single stream and stores live notification updates', async () => {
    mockFetchSession.mockResolvedValue(memberFixture);

    window.history.pushState({}, '', '/portfolio');
    render(<App />);

    expect(await screen.findByTestId('protected-area-title')).toHaveTextContent(
      'Portfolio overview',
    );

    expect(MockEventSource.instances).toHaveLength(1);

    const stream = MockEventSource.instances.at(-1);
    expect(stream).toBeDefined();

    act(() => {
      stream?.emit('notification', {
        notificationId: 101,
        channel: 'ORDER',
        message: 'Order #101 executed',
        delivered: true,
        read: false,
        readAt: null,
      });
    });

    expect(await screen.findByTestId('notification-item-101')).toHaveTextContent(
      'Order #101 executed',
    );
  });

  it('shows a visible manual-refresh fallback when EventSource is unavailable', async () => {
    const originalEventSource = globalThis.EventSource;
    const user = userEvent.setup();

    try {
      vi.stubGlobal('EventSource', undefined);
      mockFetchSession.mockResolvedValue(memberFixture);

      window.history.pushState({}, '', '/portfolio');
      render(<App />);

      expect(await screen.findByTestId('protected-area-title')).toHaveTextContent(
        'Portfolio overview',
      );
      expect(
        await screen.findByTestId('session-expiry-monitoring-unavailable'),
      ).toHaveTextContent(
        'Automatic session expiry monitoring is currently unavailable.',
      );
      expect(screen.getByTestId('session-expiry-extend')).toHaveTextContent(
        'Refresh session now',
      );

      await user.click(screen.getByTestId('session-expiry-extend'));

      await waitFor(() => {
        expect(mockFetchSession).toHaveBeenCalledTimes(2);
      });
    } finally {
      if (originalEventSource) {
        vi.stubGlobal('EventSource', originalEventSource);
      }
    }
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

  it('backfills missed notifications after reconnect succeeds', async () => {
    mockFetchSession.mockResolvedValue(memberFixture);
    mockFetchNotifications
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          notificationId: 211,
          channel: 'ORDER',
          message: 'Backfilled after reconnect',
          delivered: true,
          read: false,
          readAt: null,
        },
      ]);

    window.history.pushState({}, '', '/portfolio');
    render(<App />);

    expect(await screen.findByTestId('protected-area-title')).toHaveTextContent(
      'Portfolio overview',
    );

    vi.useFakeTimers();

    const firstStream = MockEventSource.instances.at(-1);
    expect(firstStream).toBeDefined();

    act(() => {
      firstStream?.onerror?.(new Event('error'));
      vi.advanceTimersByTime(3_000);
    });

    const secondStream = MockEventSource.instances.at(-1);
    expect(secondStream).not.toBe(firstStream);

    act(() => {
      secondStream?.onopen?.(new Event('open'));
    });

    vi.useRealTimers();

    await waitFor(() => {
      expect(mockFetchNotifications).toHaveBeenCalledTimes(2);
    });

    expect(await screen.findByTestId('notification-item-211')).toHaveTextContent(
      'Backfilled after reconnect',
    );

  });

  it('marks a notification as read in UI and backend', async () => {
    mockFetchSession.mockResolvedValue(memberFixture);
    mockFetchNotifications.mockResolvedValueOnce([
      {
        notificationId: 301,
        channel: 'ORDER',
        message: 'Unread order result',
        delivered: true,
        read: false,
        readAt: null,
      },
    ]);
    const user = userEvent.setup();

    window.history.pushState({}, '', '/portfolio');
    render(<App />);

    expect(await screen.findByTestId('notification-item-301')).toHaveTextContent(
      'Unread order result',
    );

    await user.click(screen.getByTestId('notification-mark-read-301'));

    await waitFor(() => {
      expect(mockMarkNotificationRead).toHaveBeenCalledWith(301);
    });

    expect(await screen.findByTestId('notification-read-301')).toHaveTextContent('Read');
  });

  it('shows retryable feedback when mark-as-read fails', async () => {
    mockFetchSession.mockResolvedValue(memberFixture);
    mockFetchNotifications.mockResolvedValueOnce([
      {
        notificationId: 302,
        channel: 'ORDER',
        message: 'Unread with failure path',
        delivered: true,
        read: false,
        readAt: null,
      },
    ]);
    mockMarkNotificationRead.mockRejectedValueOnce(new Error('network failure'));
    const user = userEvent.setup();

    window.history.pushState({}, '', '/portfolio');
    render(<App />);

    await user.click(await screen.findByTestId('notification-mark-read-302'));

    expect(await screen.findByTestId('notification-center-error')).toHaveTextContent(
      'Unable to mark notification as read. Please try again.',
    );
  });

  it('shows an empty-state message when no notifications exist', async () => {
    mockFetchSession.mockResolvedValue(memberFixture);
    mockFetchNotifications.mockResolvedValueOnce([]);

    window.history.pushState({}, '', '/portfolio');
    render(<App />);

    expect(await screen.findByTestId('protected-area-title')).toHaveTextContent(
      'Portfolio overview',
    );

    expect(await screen.findByTestId('notification-center-empty')).toHaveTextContent(
      'No notifications yet.',
    );
  });

  it('shows feed-unavailable guidance and supports manual refresh', async () => {
    mockFetchSession.mockResolvedValue(memberFixture);
    mockFetchNotifications
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValueOnce([
        {
          notificationId: 401,
          channel: 'ORDER',
          message: 'Recovered after manual refresh',
          delivered: true,
          read: false,
          readAt: null,
        },
      ]);
    const user = userEvent.setup();

    window.history.pushState({}, '', '/portfolio');
    render(<App />);

    expect(await screen.findByTestId('notification-feed-unavailable')).toHaveTextContent(
      'Notification feed is temporarily unavailable.',
    );

    await user.click(screen.getByTestId('notification-feed-refresh'));

    expect(await screen.findByTestId('notification-item-401')).toHaveTextContent(
      'Recovered after manual refresh',
    );
  });

  it('backs off reconnect attempts and surfaces unavailable monitoring after repeated stream failures', async () => {
    mockFetchSession.mockResolvedValue(memberFixture);

    window.history.pushState({}, '', '/portfolio');
    render(<App />);

    expect(await screen.findByTestId('protected-area-title')).toHaveTextContent(
      'Portfolio overview',
    );

    vi.useFakeTimers();

    const firstStream = MockEventSource.instances.at(-1);
    expect(firstStream).toBeDefined();

    act(() => {
      firstStream?.onerror?.(new Event('error'));
      vi.advanceTimersByTime(3_000);
    });

    const secondStream = MockEventSource.instances.at(-1);
    expect(MockEventSource.instances).toHaveLength(2);
    expect(secondStream).not.toBe(firstStream);

    act(() => {
      secondStream?.onerror?.(new Event('error'));
      vi.advanceTimersByTime(5_000);
    });

    expect(MockEventSource.instances).toHaveLength(2);

    act(() => {
      vi.advanceTimersByTime(1_000);
    });

    const thirdStream = MockEventSource.instances.at(-1);
    expect(MockEventSource.instances).toHaveLength(3);
    expect(thirdStream).not.toBe(secondStream);

    act(() => {
      thirdStream?.onerror?.(new Event('error'));
      vi.advanceTimersByTime(11_000);
    });

    expect(MockEventSource.instances).toHaveLength(3);

    act(() => {
      vi.advanceTimersByTime(1_000);
    });

    const fourthStream = MockEventSource.instances.at(-1);
    expect(MockEventSource.instances).toHaveLength(4);
    expect(fourthStream).not.toBe(thirdStream);

    act(() => {
      fourthStream?.onerror?.(new Event('error'));
      vi.runOnlyPendingTimers();
    });

    expect(
      screen.getByTestId('session-expiry-monitoring-unavailable'),
    ).toHaveTextContent('Automatic session expiry monitoring is currently unavailable.');
    expect(MockEventSource.instances).toHaveLength(4);

    vi.useRealTimers();
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
