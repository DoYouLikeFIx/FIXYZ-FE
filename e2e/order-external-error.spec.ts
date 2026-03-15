import { expect, test, type Page, type Route } from '@playwright/test';

type OrderScenario = 'success' | 'fep-002' | 'unknown';

const createMemberFixture = (overrides?: Partial<{
  memberUuid: string;
  email: string;
  name: string;
  role: string;
  totpEnrolled: boolean;
  accountId?: string;
}>) => ({
  memberUuid: 'member-001',
  email: 'demo@fix.com',
  name: 'Demo User',
  role: 'ROLE_USER',
  totpEnrolled: true,
  accountId: '1',
  ...overrides,
});

const memberFixture = createMemberFixture();

interface CapturedOrderSessionCreateRequest {
  accountId: number | null;
  headerClOrdId?: string;
  price: number | null;
  qty: number | null;
  side: string | null;
  symbol: string | null;
}

const successEnvelope = <T,>(data: T) => ({
  success: true,
  data,
  error: null,
});

const errorEnvelope = (
  code: string,
  message: string,
  detail: string,
  options?: {
    operatorCode?: string;
    retryAfterSeconds?: number;
    traceId?: string;
  },
) => ({
  success: false,
  data: null,
  traceId: options?.traceId,
  error: {
    code,
    message,
    detail,
    operatorCode: options?.operatorCode,
    retryAfterSeconds: options?.retryAfterSeconds,
    timestamp: '2026-03-11T00:00:00.000Z',
  },
});

const directErrorPayload = (
  code: string,
  message: string,
  path: string,
  correlationId: string,
) => ({
  code,
  message,
  path,
  correlationId,
  timestamp: '2026-03-11T00:00:00.000Z',
});

const fulfillJson = async (route: Route, status: number, body: unknown) => {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
};

const installMockEventSource = async (page: Page) => {
  await page.addInitScript(() => {
    class MockEventSource {
      url: string;

      withCredentials: boolean;

      readyState = 1;

      onerror: ((event: Event) => void) | null = null;

      constructor(url: string | URL, init?: EventSourceInit) {
        this.url = String(url);
        this.withCredentials = init?.withCredentials ?? false;
      }

      addEventListener() {}

      removeEventListener() {}

      close() {
        this.readyState = 2;
      }
    }

    Object.defineProperty(globalThis, 'EventSource', {
      configurable: true,
      writable: true,
      value: MockEventSource,
    });
  });
};

const installMockApi = async (
  page: Page,
  orderScenario: OrderScenario,
  member = memberFixture,
) => {
  let authenticated = false;
  const sessionCreateRequests: CapturedOrderSessionCreateRequest[] = [];
  const executeSessionIds: string[] = [];

  await installMockEventSource(page);

  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;

    if (pathname === '/api/v1/auth/csrf' && request.method() === 'GET') {
      await fulfillJson(route, 200, successEnvelope({
        csrfToken: 'csrf-e2e-token',
        headerName: 'X-CSRF-TOKEN',
      }));
      return;
    }

    if (pathname === '/api/v1/auth/session' && request.method() === 'GET') {
      if (authenticated) {
        await fulfillJson(route, 200, successEnvelope(member));
        return;
      }

      await fulfillJson(
        route,
        401,
        directErrorPayload(
          'AUTH-003',
          'Authentication required',
          '/api/v1/auth/session',
          'corr-auth-session',
        ),
      );
      return;
    }

    if (pathname === '/api/v1/auth/login' && request.method() === 'POST') {
      await fulfillJson(route, 200, successEnvelope({
        loginToken: 'login-token',
        nextAction: 'VERIFY_TOTP',
        totpEnrolled: true,
        expiresAt: '2026-03-11T00:10:00Z',
      }));
      return;
    }

    if (pathname === '/api/v1/auth/otp/verify' && request.method() === 'POST') {
      authenticated = true;
      await fulfillJson(route, 200, successEnvelope(member));
      return;
    }

    if (pathname === '/api/v1/orders/sessions' && request.method() === 'POST') {
      const body = request.postDataJSON() as Record<string, unknown>;
      sessionCreateRequests.push({
        accountId: typeof body.accountId === 'number' ? body.accountId : null,
        headerClOrdId: request.headers()['x-clordid'],
        price: typeof body.price === 'number' ? body.price : null,
        qty: typeof body.qty === 'number' ? body.qty : null,
        side: typeof body.side === 'string' ? body.side : null,
        symbol: typeof body.symbol === 'string' ? body.symbol : null,
      });

      await fulfillJson(route, 201, successEnvelope({
        orderSessionId: 'sess-e2e-001',
        clOrdId: request.headers()['x-clordid'],
        status: 'AUTHED',
        challengeRequired: false,
        authorizationReason: 'RECENT_LOGIN_MFA',
        accountId: 1,
        symbol: body.symbol,
        side: body.side,
        orderType: 'LIMIT',
        qty: body.qty,
        price: body.price,
        expiresAt: '2026-03-11T00:10:00Z',
      }));
      return;
    }

    if (pathname === '/api/v1/orders/sessions/sess-e2e-001/execute' && request.method() === 'POST') {
      executeSessionIds.push('sess-e2e-001');
      const latestSessionCreateRequest =
        sessionCreateRequests[sessionCreateRequests.length - 1];

      if (orderScenario === 'success') {
        await fulfillJson(route, 200, successEnvelope({
          orderSessionId: 'sess-e2e-001',
          clOrdId: latestSessionCreateRequest?.headerClOrdId ?? 'cl-e2e-001',
          status: 'COMPLETED',
          challengeRequired: false,
          authorizationReason: 'RECENT_LOGIN_MFA',
          accountId: 1,
          symbol: latestSessionCreateRequest?.symbol ?? '005930',
          side: latestSessionCreateRequest?.side ?? 'BUY',
          orderType: 'LIMIT',
          qty: latestSessionCreateRequest?.qty ?? 1,
          price: latestSessionCreateRequest?.price ?? 70100,
          executionResult: 'FILLED',
          executedQty: latestSessionCreateRequest?.qty ?? 1,
          leavesQty: 0,
          executedPrice: latestSessionCreateRequest?.price ?? 70100,
          externalOrderId: 'ord-e2e-001',
          expiresAt: '2026-03-11T00:10:00Z',
        }));
        return;
      }

      if (orderScenario === 'fep-002') {
        await fulfillJson(
          route,
          504,
          errorEnvelope(
            'FEP-002',
            '주문이 아직 확정되지 않았습니다. 체결 완료로 간주하지 말고 알림이나 주문 상태를 확인해 주세요.',
            'External order status is pending',
            {
              operatorCode: 'TIMEOUT',
              traceId: 'trace-fep-002',
            },
          ),
        );
        return;
      }

      await fulfillJson(
        route,
        503,
        errorEnvelope(
          'FEP-999',
          'Unknown external state',
          'Broker state is unavailable',
          {
            operatorCode: 'UNKNOWN_EXTERNAL_STATE',
            traceId: 'trace-unknown-001',
          },
        ),
      );
      return;
    }

    await fulfillJson(
      route,
      404,
      errorEnvelope(
        'SYS-404',
        `Unhandled request: ${request.method()} ${pathname}`,
        'Playwright mock route is missing a handler',
      ),
    );
  });

  return {
    executeSessionIds,
    sessionCreateRequests,
  };
};

const loginAndOpenOrderBoundary = async (page: Page, orderScenario: OrderScenario) => {
  const mockApi = await installMockApi(page, orderScenario);

  await page.goto('/login');
  await expect(page.getByTestId('login-email')).toBeVisible();

  await page.getByTestId('login-email').fill('demo@fix.com');
  await page.getByTestId('login-password').fill('Test1234!');
  await page.getByRole('button', { name: '로그인' }).click();
  await page.getByTestId('login-mfa-input').fill('123456');
  await page.getByTestId('login-mfa-submit').click();

  await expect(page).toHaveURL(/\/portfolio$/);
  await page.getByRole('link', { name: '주문 경계 열기' }).click();
  await expect(page).toHaveURL(/\/orders$/);
  await expect(page.getByTestId('protected-area-title')).toHaveText(
    'Session-based order flow',
  );

  return mockApi;
};

test.describe('external order recovery e2e', () => {
  test('shows success feedback for accepted order submissions without rendering the external error panel', async ({
    page,
  }) => {
    const mockApi = await loginAndOpenOrderBoundary(page, 'success');

    await page.getByTestId('order-session-create').click();
    await page.getByTestId('order-session-execute').click();

    await expect(page.getByTestId('external-order-feedback')).toHaveText(
      '주문이 접수되었습니다. 주문 요약을 확인해 주세요.',
    );
    await expect(page.getByTestId('order-session-summary')).toContainText('상태 COMPLETED');
    await expect(page.getByTestId('order-session-reset')).toBeVisible();
    await expect(page.getByTestId('external-order-error-panel')).toHaveCount(0);
    expect(mockApi.sessionCreateRequests).toHaveLength(1);
    expect(mockApi.executeSessionIds).toEqual(['sess-e2e-001']);
    expect(mockApi.sessionCreateRequests[0]).toMatchObject({
      accountId: 1,
      symbol: '005930',
      side: 'BUY',
      qty: 1,
      price: 70100,
    });
    expect(mockApi.sessionCreateRequests[0].headerClOrdId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  test('renders actionable pending-confirmation guidance when the order channel returns FEP-002', async ({
    page,
  }) => {
    const mockApi = await loginAndOpenOrderBoundary(page, 'fep-002');

    await page.getByRole('tab', { name: '2주' }).click();
    await page.getByTestId('order-session-create').click();
    await page.getByTestId('order-session-execute').click();

    await expect(page.getByTestId('external-order-error-title')).toHaveText(
      '주문 결과를 확인하고 있습니다',
    );
    await expect(page.getByTestId('external-order-error-message')).toContainText(
      '체결 완료로 간주하지 말고',
    );
    await expect(page.getByTestId('external-order-error-support-reference')).toHaveText(
      '문의 코드: trace-fep-002',
    );
    expect(mockApi.sessionCreateRequests).toHaveLength(1);
    expect(mockApi.executeSessionIds).toEqual(['sess-e2e-001']);
    expect(mockApi.sessionCreateRequests[0]).toMatchObject({
      accountId: 1,
      symbol: '005930',
      side: 'BUY',
      qty: 2,
      price: 70100,
    });
  });

  test('falls back to the safe unknown-state recovery copy for ambiguous external failures', async ({
    page,
  }) => {
    await loginAndOpenOrderBoundary(page, 'unknown');

    await page.getByTestId('order-session-create').click();
    await page.getByTestId('order-session-execute').click();

    await expect(page.getByTestId('external-order-error-title')).toHaveText(
      '주문 상태 확인이 더 필요합니다',
    );
    await expect(page.getByTestId('external-order-error-next-step')).toContainText(
      '문의 코드와 함께 고객센터에 연락',
    );
    await expect(page.getByTestId('external-order-error-support-reference')).toHaveText(
      '문의 코드: trace-unknown-001',
    );
    await expect(page.getByTestId('external-order-feedback')).toHaveCount(0);
  });

  test('keeps the order boundary unavailable for authenticated users without a linked order account', async ({
    page,
  }) => {
    await installMockApi(page, 'success', createMemberFixture({ accountId: undefined }));

    await page.goto('/login');
    await expect(page.getByTestId('login-email')).toBeVisible();

    await page.getByTestId('login-email').fill('demo@fix.com');
    await page.getByTestId('login-password').fill('Test1234!');
    await page.getByRole('button', { name: '로그인' }).click();
    await page.getByTestId('login-mfa-input').fill('123456');
    await page.getByTestId('login-mfa-submit').click();

    await expect(page).toHaveURL(/\/portfolio$/);
    await expect(page.getByTestId('portfolio-demo-order')).toHaveCount(0);
    await expect(page.getByTestId('portfolio-demo-order-unavailable')).toBeDisabled();

    await page.goto('/orders');
    await expect(page.getByTestId('order-boundary-unavailable')).toBeVisible();
    await expect(page.getByTestId('order-session-create')).toHaveCount(0);
  });
});
