import type { AxiosAdapter, AxiosResponse } from 'axios';

interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

interface MockHttpResponse {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
  statusText?: string;
}

const successEnvelope = <T,>(data: T): MockHttpResponse => ({
  status: 200,
  body: {
    success: true,
    data,
    error: null,
  },
});

const normalizeHeaders = (headers: unknown): Record<string, string> => {
  if (!headers) {
    return {};
  }

  if (
    typeof headers === 'object'
    && headers !== null
    && 'toJSON' in headers
    && typeof (headers as { toJSON: () => Record<string, string> }).toJSON === 'function'
  ) {
    return (headers as { toJSON: () => Record<string, string> }).toJSON();
  }

  return {
    ...(headers as Record<string, string>),
  };
};

const normalizeBody = (body: unknown): string | undefined => {
  if (typeof body === 'string') {
    return body;
  }

  if (body instanceof URLSearchParams) {
    return body.toString();
  }

  return body === undefined || body === null
    ? undefined
    : JSON.stringify(body);
};

const getPathname = (url: string) => new URL(url, 'http://localhost').pathname;

const getFormBody = (body: string | undefined) =>
  Object.fromEntries(new URLSearchParams(body ?? '').entries());

const findCalls = (
  calls: RecordedCall[],
  pathname: string,
  method: string,
) => calls.filter(
  (call) => call.method === method && getPathname(call.url) === pathname,
);

const createAxiosHarness = async (
  handler: (request: RecordedCall) => Promise<MockHttpResponse> | MockHttpResponse,
) => {
  vi.resetModules();
  const actualAxios = await vi.importActual<typeof import('axios')>('axios');

  const adapter: AxiosAdapter = async (config) => {
    const request: RecordedCall = {
      url: config.url ?? '/',
      method: (config.method ?? 'get').toUpperCase(),
      headers: normalizeHeaders(config.headers),
      body: normalizeBody(config.data),
    };

    calls.push(request);

    const response = await handler(request);
    const axiosResponse = {
      data: response.body,
      status: response.status,
      statusText: response.statusText ?? 'OK',
      headers: response.headers ?? {},
      config,
    } as AxiosResponse;

    if (response.status >= 400) {
      throw new actualAxios.AxiosError(
        `Request failed with status code ${response.status}`,
        'ERR_BAD_REQUEST',
        config,
        undefined,
        axiosResponse,
      );
    }

    return axiosResponse;
  };

  const calls: RecordedCall[] = [];

  vi.doMock('axios', async () => {
    return {
      ...actualAxios,
      default: {
        create: (config?: Record<string, unknown>) =>
          actualAxios.default.create({
            ...(config ?? {}),
            adapter,
          }),
        isAxiosError: actualAxios.default.isAxiosError,
      },
    };
  });

  const axiosLib = await import('@/lib/axios');
  const authApi = await import('@/api/authApi');
  const orderApi = await import('@/api/orderApi');
  const authStore = await import('@/store/useAuthStore');

  axiosLib.clearCsrfToken();
  authStore.resetAuthStore();

  return {
    calls,
    clearCsrfToken: axiosLib.clearCsrfToken,
    resetAuthStore: authStore.resetAuthStore,
    ...authApi,
    ...orderApi,
  };
};

describe.sequential('BE-FE auth contract integration', () => {
  afterEach(() => {
    vi.doUnmock('axios');
    vi.restoreAllMocks();
  });

  it('completes login MFA, refreshes csrf, and retries the first raw 403 protected mutation', async () => {
    let csrfTokenVersion = 0;
    let sessionCreateAttempts = 0;

    const harness = await createAxiosHarness((request) => {
      if (request.method === 'GET' && getPathname(request.url) === '/api/v1/auth/csrf') {
        csrfTokenVersion += 1;

        return successEnvelope({
          token: `csrf-login-${csrfTokenVersion}`,
        });
      }

      if (request.method === 'POST' && getPathname(request.url) === '/api/v1/auth/login') {
        return successEnvelope({
          loginToken: 'login-token',
          nextAction: 'VERIFY_TOTP',
          totpEnrolled: true,
          expiresAt: '2026-03-12T10:00:00Z',
        });
      }

      if (request.method === 'POST' && getPathname(request.url) === '/api/v1/auth/otp/verify') {
        return successEnvelope({
          memberId: 1,
          email: 'demo@fix.com',
          name: 'Demo User',
          totpEnrolled: true,
          accountId: '1',
        });
      }

      if (request.method === 'POST' && getPathname(request.url) === '/api/v1/orders/sessions') {
        sessionCreateAttempts += 1;

        if (sessionCreateAttempts === 1) {
          return {
            status: 403,
            body: '',
          };
        }

        return successEnvelope({
          orderSessionId: 'sess-001',
          clOrdId: 'cl-001',
          status: 'AUTHED',
          challengeRequired: false,
          authorizationReason: 'RECENT_LOGIN_MFA',
          accountId: 1,
          symbol: '005930',
          side: 'BUY',
          orderType: 'LIMIT',
          qty: 2,
          price: 70100,
          expiresAt: '2026-03-12T10:10:00Z',
        });
      }

      if (request.method === 'POST'
        && getPathname(request.url) === '/api/v1/orders/sessions/sess-001/execute') {
        return successEnvelope({
          orderSessionId: 'sess-001',
          clOrdId: 'cl-001',
          status: 'COMPLETED',
          challengeRequired: false,
          authorizationReason: 'RECENT_LOGIN_MFA',
          accountId: 1,
          symbol: '005930',
          side: 'BUY',
          orderType: 'LIMIT',
          qty: 2,
          price: 70100,
          executionResult: 'FILLED',
          executedQty: 2,
          leavesQty: 0,
          executedPrice: 70100,
          externalOrderId: 'ord-1001',
          expiresAt: '2026-03-12T10:10:00Z',
        });
      }

      throw new Error(`Unhandled request: ${request.method} ${request.url}`);
    });

    await expect(
      harness.startLoginFlow({
        email: 'demo@fix.com',
        password: 'Test1234!',
      }),
    ).resolves.toMatchObject({
      loginToken: 'login-token',
      nextAction: 'VERIFY_TOTP',
    });

    await expect(
      harness.verifyLoginOtp({
        loginToken: 'login-token',
        otpCode: '123456',
      }),
    ).resolves.toMatchObject({
      memberUuid: '1',
      email: 'demo@fix.com',
      totpEnrolled: true,
    });

    await expect(
      harness.createOrderSession({
        accountId: 1,
        clOrdId: 'cl-001',
        symbol: '005930',
        side: 'BUY',
        quantity: 2,
        price: 70100,
      }),
    ).resolves.toEqual({
      orderSessionId: 'sess-001',
      clOrdId: 'cl-001',
      status: 'AUTHED',
      challengeRequired: false,
      authorizationReason: 'RECENT_LOGIN_MFA',
      accountId: 1,
      symbol: '005930',
      side: 'BUY',
      orderType: 'LIMIT',
      qty: 2,
      price: 70100,
      expiresAt: '2026-03-12T10:10:00Z',
    });

    await expect(
      harness.executeOrderSession('sess-001'),
    ).resolves.toEqual({
      orderSessionId: 'sess-001',
      clOrdId: 'cl-001',
      status: 'COMPLETED',
      challengeRequired: false,
      authorizationReason: 'RECENT_LOGIN_MFA',
      accountId: 1,
      symbol: '005930',
      side: 'BUY',
      orderType: 'LIMIT',
      qty: 2,
      price: 70100,
      executionResult: 'FILLED',
      executedQty: 2,
      leavesQty: 0,
      executedPrice: 70100,
      externalOrderId: 'ord-1001',
      expiresAt: '2026-03-12T10:10:00Z',
    });

    const csrfCalls = findCalls(harness.calls, '/api/v1/auth/csrf', 'GET');
    const loginCalls = findCalls(harness.calls, '/api/v1/auth/login', 'POST');
    const verifyCalls = findCalls(harness.calls, '/api/v1/auth/otp/verify', 'POST');
    const createCalls = findCalls(harness.calls, '/api/v1/orders/sessions', 'POST');
    const executeCalls = findCalls(
      harness.calls,
      '/api/v1/orders/sessions/sess-001/execute',
      'POST',
    );

    expect(csrfCalls).toHaveLength(3);
    expect(loginCalls).toHaveLength(1);
    expect(verifyCalls).toHaveLength(1);
    expect(createCalls).toHaveLength(2);
    expect(executeCalls).toHaveLength(1);

    expect(loginCalls[0]?.headers['X-CSRF-TOKEN']).toBe('csrf-login-1');
    expect(verifyCalls[0]?.headers['X-CSRF-TOKEN']).toBe('csrf-login-1');
    expect(createCalls[0]?.headers['X-CSRF-TOKEN']).toBe('csrf-login-2');
    expect(createCalls[1]?.headers['X-CSRF-TOKEN']).toBe('csrf-login-3');
    expect(executeCalls[0]?.headers['X-CSRF-TOKEN']).toBe('csrf-login-3');
    expect(getFormBody(loginCalls[0]?.body)).toEqual({
      email: 'demo@fix.com',
      password: 'Test1234!',
    });
    expect(verifyCalls[0]?.body).toBe(JSON.stringify({
      loginToken: 'login-token',
      otpCode: '123456',
    }));
    expect(createCalls[1]?.body).toBe(JSON.stringify({
      accountId: 1,
      symbol: '005930',
      side: 'BUY',
      orderType: 'LIMIT',
      qty: 2,
      price: 70100,
    }));
  });

  it('registers, enrolls TOTP, refreshes csrf after confirm, and uses the new token for the next protected mutation', async () => {
    let csrfTokenVersion = 0;

    const harness = await createAxiosHarness((request) => {
      if (request.method === 'GET' && getPathname(request.url) === '/api/v1/auth/csrf') {
        csrfTokenVersion += 1;

        return successEnvelope({
          token: `csrf-enroll-${csrfTokenVersion}`,
        });
      }

      if (request.method === 'POST' && getPathname(request.url) === '/api/v1/auth/register') {
        return successEnvelope({
          memberId: 2,
          email: 'new@fix.com',
          name: 'New User',
        });
      }

      if (request.method === 'POST' && getPathname(request.url) === '/api/v1/auth/login') {
        return successEnvelope({
          loginToken: 'enroll-login-token',
          nextAction: 'ENROLL_TOTP',
          totpEnrolled: false,
          expiresAt: '2026-03-12T10:05:00Z',
        });
      }

      if (request.method === 'POST' && getPathname(request.url) === '/api/v1/members/me/totp/enroll') {
        return successEnvelope({
          qrUri: 'otpauth://totp/FIX:new@fix.com?secret=NEW123',
          manualEntryKey: 'NEW123',
          enrollmentToken: 'enrollment-token',
          expiresAt: '2026-03-12T10:08:00Z',
        });
      }

      if (request.method === 'POST' && getPathname(request.url) === '/api/v1/members/me/totp/confirm') {
        return successEnvelope({
          memberId: 2,
          email: 'new@fix.com',
          name: 'New User',
          totpEnrolled: true,
          accountId: '2',
        });
      }

      if (request.method === 'POST' && getPathname(request.url) === '/api/v1/orders/sessions') {
        return successEnvelope({
          orderSessionId: 'sess-enroll-001',
          clOrdId: 'cl-enroll-001',
          status: 'AUTHED',
          challengeRequired: false,
          authorizationReason: 'RECENT_LOGIN_MFA',
          accountId: 2,
          symbol: '005930',
          side: 'BUY',
          orderType: 'LIMIT',
          qty: 1,
          price: 70100,
          expiresAt: '2026-03-12T10:15:00Z',
        });
      }

      if (request.method === 'POST'
        && getPathname(request.url) === '/api/v1/orders/sessions/sess-enroll-001/execute') {
        return successEnvelope({
          orderSessionId: 'sess-enroll-001',
          clOrdId: 'cl-enroll-001',
          status: 'COMPLETED',
          challengeRequired: false,
          authorizationReason: 'RECENT_LOGIN_MFA',
          accountId: 2,
          symbol: '005930',
          side: 'BUY',
          orderType: 'LIMIT',
          qty: 1,
          price: 70100,
          executionResult: 'FILLED',
          executedQty: 1,
          leavesQty: 0,
          executedPrice: 70100,
          externalOrderId: 'ord-2002',
          expiresAt: '2026-03-12T10:15:00Z',
        });
      }

      throw new Error(`Unhandled request: ${request.method} ${request.url}`);
    });

    await expect(
      harness.registerMember({
        email: 'new@fix.com',
        password: 'Test1234!',
        name: 'New User',
      }),
    ).resolves.toMatchObject({
      memberUuid: '2',
      email: 'new@fix.com',
      totpEnrolled: false,
    });

    await expect(
      harness.startLoginFlow({
        email: 'new@fix.com',
        password: 'Test1234!',
      }),
    ).resolves.toMatchObject({
      loginToken: 'enroll-login-token',
      nextAction: 'ENROLL_TOTP',
    });

    await expect(
      harness.beginTotpEnrollment({
        loginToken: 'enroll-login-token',
      }),
    ).resolves.toEqual({
      qrUri: 'otpauth://totp/FIX:new@fix.com?secret=NEW123',
      manualEntryKey: 'NEW123',
      enrollmentToken: 'enrollment-token',
      expiresAt: '2026-03-12T10:08:00Z',
    });

    await expect(
      harness.confirmTotpEnrollment({
        loginToken: 'enroll-login-token',
        enrollmentToken: 'enrollment-token',
        otpCode: '123456',
      }),
    ).resolves.toMatchObject({
      memberUuid: '2',
      email: 'new@fix.com',
      totpEnrolled: true,
      accountId: '2',
    });

    await expect(
      harness.createOrderSession({
        accountId: 2,
        clOrdId: 'cl-enroll-001',
        symbol: '005930',
        side: 'BUY',
        quantity: 1,
        price: 70100,
      }),
    ).resolves.toEqual({
      orderSessionId: 'sess-enroll-001',
      clOrdId: 'cl-enroll-001',
      status: 'AUTHED',
      challengeRequired: false,
      authorizationReason: 'RECENT_LOGIN_MFA',
      accountId: 2,
      symbol: '005930',
      side: 'BUY',
      orderType: 'LIMIT',
      qty: 1,
      price: 70100,
      expiresAt: '2026-03-12T10:15:00Z',
    });

    await expect(
      harness.executeOrderSession('sess-enroll-001'),
    ).resolves.toEqual({
      orderSessionId: 'sess-enroll-001',
      clOrdId: 'cl-enroll-001',
      status: 'COMPLETED',
      challengeRequired: false,
      authorizationReason: 'RECENT_LOGIN_MFA',
      accountId: 2,
      symbol: '005930',
      side: 'BUY',
      orderType: 'LIMIT',
      qty: 1,
      price: 70100,
      executionResult: 'FILLED',
      executedQty: 1,
      leavesQty: 0,
      executedPrice: 70100,
      externalOrderId: 'ord-2002',
      expiresAt: '2026-03-12T10:15:00Z',
    });

    const csrfCalls = findCalls(harness.calls, '/api/v1/auth/csrf', 'GET');
    const registerCalls = findCalls(harness.calls, '/api/v1/auth/register', 'POST');
    const loginCalls = findCalls(harness.calls, '/api/v1/auth/login', 'POST');
    const enrollCalls = findCalls(harness.calls, '/api/v1/members/me/totp/enroll', 'POST');
    const confirmCalls = findCalls(harness.calls, '/api/v1/members/me/totp/confirm', 'POST');
    const createCalls = findCalls(harness.calls, '/api/v1/orders/sessions', 'POST');
    const executeCalls = findCalls(
      harness.calls,
      '/api/v1/orders/sessions/sess-enroll-001/execute',
      'POST',
    );

    expect(csrfCalls).toHaveLength(3);
    expect(registerCalls[0]?.headers['X-CSRF-TOKEN']).toBe('csrf-enroll-1');
    expect(loginCalls[0]?.headers['X-CSRF-TOKEN']).toBe('csrf-enroll-2');
    expect(enrollCalls[0]?.headers['X-CSRF-TOKEN']).toBe('csrf-enroll-2');
    expect(confirmCalls[0]?.headers['X-CSRF-TOKEN']).toBe('csrf-enroll-2');
    expect(createCalls[0]?.headers['X-CSRF-TOKEN']).toBe('csrf-enroll-3');
    expect(executeCalls[0]?.headers['X-CSRF-TOKEN']).toBe('csrf-enroll-3');
    expect(getFormBody(registerCalls[0]?.body)).toEqual({
      email: 'new@fix.com',
      password: 'Test1234!',
      name: 'New User',
    });
    expect(getFormBody(loginCalls[0]?.body)).toEqual({
      email: 'new@fix.com',
      password: 'Test1234!',
    });
    expect(confirmCalls[0]?.body).toBe(JSON.stringify({
      loginToken: 'enroll-login-token',
      enrollmentToken: 'enrollment-token',
      otpCode: '123456',
    }));
    expect(createCalls[0]?.body).toBe(JSON.stringify({
      accountId: 2,
      symbol: '005930',
      side: 'BUY',
      orderType: 'LIMIT',
      qty: 1,
      price: 70100,
    }));
  });
});
