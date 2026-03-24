import { expect, test, type Page, type Route } from '@playwright/test';

const memberFixture = {
  memberUuid: 'member-market-ticker-001',
  email: 'demo@fix.com',
  name: 'Demo User',
  role: 'ROLE_USER',
  totpEnrolled: true,
  accountId: '1',
};

interface CapturedMarketCreateRequest {
  accountId: number | null;
  headerClOrdId?: string;
  orderType: string | null;
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
  timestamp: '2026-03-23T00:00:00.000Z',
});

const errorEnvelope = (
  code: string,
  message: string,
  detail: string,
  options?: {
    details?: Record<string, unknown>;
    operatorCode?: string;
    retryAfterSeconds?: number;
    traceId?: string;
    userMessageKey?: string;
  },
) => ({
  success: false,
  data: null,
  traceId: options?.traceId,
  error: {
    code,
    message,
    detail,
    details: options?.details,
    operatorCode: options?.operatorCode,
    retryAfterSeconds: options?.retryAfterSeconds,
    userMessageKey: options?.userMessageKey,
    timestamp: '2026-03-23T00:00:00.000Z',
  },
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

const installMockApi = async (page: Page) => {
  const sessionExpiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  let authenticated = false;
  let marketTickerRequestCount = 0;
  const sessionCreateRequests: CapturedMarketCreateRequest[] = [];

  await installMockEventSource(page);

  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const pathname = url.pathname;

    if (pathname === '/api/v1/auth/csrf' && request.method() === 'GET') {
      await fulfillJson(route, 200, successEnvelope({
        csrfToken: 'csrf-market-ticker-e2e',
        headerName: 'X-CSRF-TOKEN',
      }));
      return;
    }

    if (pathname === '/api/v1/auth/session' && request.method() === 'GET') {
      if (authenticated) {
        await fulfillJson(route, 200, successEnvelope(memberFixture));
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
        expiresAt: sessionExpiresAt,
      }));
      return;
    }

    if (pathname === '/api/v1/auth/otp/verify' && request.method() === 'POST') {
      authenticated = true;
      await fulfillJson(route, 200, successEnvelope(memberFixture));
      return;
    }

    if (pathname === '/api/v1/accounts/1/summary' && request.method() === 'GET') {
      await fulfillJson(route, 200, successEnvelope({
        accountId: 1,
        memberId: 1,
        symbol: '',
        quantity: 0,
        availableQuantity: 0,
        availableQty: 0,
        balance: 100_000_000,
        availableBalance: 100_000_000,
        currency: 'KRW',
        asOf: '2026-03-23T09:00:00Z',
      }));
      return;
    }

    if (pathname === '/api/v1/accounts/1/positions/list' && request.method() === 'GET') {
      await fulfillJson(route, 200, successEnvelope([
        {
          accountId: 1,
          memberId: 1,
          symbol: '005930',
          quantity: 120,
          availableQuantity: 20,
          availableQty: 20,
          balance: 100_000_000,
          availableBalance: 100_000_000,
          currency: 'KRW',
          asOf: '2026-03-23T09:00:00Z',
          avgPrice: 68_900,
          marketPrice: 70_100,
          quoteSnapshotId: 'qsnap-live-001',
          quoteAsOf: '2026-03-23T09:00:00Z',
          quoteSourceMode: 'LIVE',
          unrealizedPnl: 144_000,
          realizedPnlDaily: 12_000,
          valuationStatus: 'FRESH',
          valuationUnavailableReason: null,
        },
      ]));
      return;
    }

    if (pathname === '/api/v1/accounts/1/positions' && request.method() === 'GET') {
      marketTickerRequestCount += 1;
      const isReplayTick = marketTickerRequestCount > 1;

      await fulfillJson(route, 200, successEnvelope({
        accountId: 1,
        memberId: 1,
        symbol: url.searchParams.get('symbol') ?? '005930',
        quantity: 120,
        availableQuantity: 20,
        availableQty: 20,
        balance: 100_000_000,
        availableBalance: 100_000_000,
        currency: 'KRW',
        asOf: '2026-03-23T09:00:00Z',
        avgPrice: 68_900,
        marketPrice: isReplayTick ? 70_300 : 70_100,
        quoteSnapshotId: isReplayTick ? 'qsnap-replay-001' : 'qsnap-live-001',
        quoteAsOf: isReplayTick ? '2026-03-23T09:05:00Z' : '2026-03-23T09:00:00Z',
        quoteSourceMode: isReplayTick ? 'REPLAY' : 'LIVE',
        unrealizedPnl: isReplayTick ? 168_000 : 144_000,
        realizedPnlDaily: isReplayTick ? 20_000 : 12_000,
        valuationStatus: isReplayTick ? 'STALE' : 'FRESH',
        valuationUnavailableReason: isReplayTick ? 'STALE_QUOTE' : null,
      }));
      return;
    }

    if (pathname === '/api/v1/accounts/1/orders' && request.method() === 'GET') {
      await fulfillJson(route, 200, successEnvelope({
        content: [],
        totalElements: 0,
        totalPages: 0,
        number: 0,
        size: 10,
      }));
      return;
    }

    if (pathname === '/api/v1/orders/sessions' && request.method() === 'POST') {
      const body = request.postDataJSON() as Record<string, unknown>;
      sessionCreateRequests.push({
        accountId: typeof body.accountId === 'number' ? body.accountId : null,
        headerClOrdId: request.headers()['x-clordid'],
        orderType: typeof body.orderType === 'string' ? body.orderType : null,
        price: typeof body.price === 'number' ? body.price : null,
        qty: typeof body.qty === 'number' ? body.qty : null,
        side: typeof body.side === 'string' ? body.side : null,
        symbol: typeof body.symbol === 'string' ? body.symbol : null,
      });

      await fulfillJson(
        route,
        400,
        errorEnvelope(
          'VALIDATION-003',
          '시장가 주문에 사용할 시세가 오래되었습니다.',
          '시장가 주문에 사용한 quote snapshot이 허용 범위를 초과했습니다.',
          {
            operatorCode: 'STALE_QUOTE',
            traceId: 'trace-stale-quote-e2e',
            userMessageKey: 'error.quote.stale',
            details: {
              symbol: '005930',
              quoteSnapshotId: 'qsnap-replay-001',
              quoteSourceMode: 'REPLAY',
              snapshotAgeMs: 65_000,
            },
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
    getMarketTickerRequestCount: () => marketTickerRequestCount,
    sessionCreateRequests,
  };
};

const loginAndOpenOrderBoundary = async (page: Page) => {
  const mockApi = await installMockApi(page);

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

  return mockApi;
};

test.describe('market ticker order e2e', () => {
  test('refreshes the market ticker and keeps stale-quote guidance on Step A', async ({ page }) => {
    const mockApi = await loginAndOpenOrderBoundary(page);

    await page.getByTestId('external-order-preset-krx-market-buy-3').click();

    await expect(page.getByTestId('market-order-live-ticker')).toBeVisible();
    await expect(page.getByTestId('market-order-live-ticker-status')).toContainText(
      '5초마다 자동 갱신',
    );
    await expect(page.getByTestId('market-order-live-ticker-price')).toHaveText('₩70,100');
    await expect(page.getByTestId('market-order-live-ticker-source-mode')).toHaveText('LIVE');
    await expect(page.getByTestId('market-order-live-ticker-valuation-status')).toHaveText(
      '평가 가능',
    );

    await expect(page.getByTestId('market-order-live-ticker-price')).toHaveText('확인 불가', {
      timeout: 8_000,
    });
    await expect(page.getByTestId('market-order-live-ticker-source-mode')).toHaveText('REPLAY');
    await expect(page.getByTestId('market-order-live-ticker-valuation-status')).toHaveText(
      '시세 지연',
    );
    await expect(page.getByTestId('market-order-live-ticker-guidance')).toContainText(
      '호가 기준이 오래되어 평가 손익을 숨겼습니다.',
    );
    expect(mockApi.getMarketTickerRequestCount()).toBeGreaterThanOrEqual(2);

    await page.getByTestId('order-session-create').click();

    await expect(page.getByTestId('order-session-stale-quote-guidance')).toContainText(
      'quoteSnapshotId=qsnap-replay-001',
    );
    await expect(page.getByTestId('order-session-stale-quote-guidance')).toContainText(
      'quoteSourceMode=REPLAY',
    );
    await expect(page.getByTestId('order-session-stale-quote-guidance')).toContainText(
      'snapshotAgeMs=65000',
    );
    await expect(page.getByTestId('order-session-create')).toBeVisible();
    await expect(page.getByTestId('order-session-execute')).toHaveCount(0);

    expect(mockApi.sessionCreateRequests).toHaveLength(1);
    expect(mockApi.sessionCreateRequests[0]).toMatchObject({
      accountId: 1,
      orderType: 'MARKET',
      price: null,
      qty: 3,
      side: 'BUY',
      symbol: '005930',
    });
    expect(mockApi.sessionCreateRequests[0].headerClOrdId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });
});
