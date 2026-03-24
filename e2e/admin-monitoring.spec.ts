import { expect, test, type Page, type Route } from '@playwright/test';

const adminMemberFixture = {
  memberUuid: 'member-admin-001',
  email: 'ops-admin@fix.com',
  name: 'Ops Admin',
  role: 'ROLE_ADMIN',
  totpEnrolled: true,
  accountId: '1',
};

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
  timestamp: '2026-03-24T00:00:00.000Z',
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
      static OPEN = 1;

      static CLOSED = 2;

      public readonly url: string;

      public readonly withCredentials: boolean;

      public readyState = MockEventSource.OPEN;

      public onopen: ((event: Event) => void) | null = null;

      public onerror: ((event: Event) => void) | null = null;

      public onmessage: ((event: MessageEvent) => void) | null = null;

      private readonly listeners = new Map<string, Set<(event: MessageEvent) => void>>();

      constructor(url: string | URL, init?: EventSourceInit) {
        this.url = String(url);
        this.withCredentials = init?.withCredentials ?? false;
        queueMicrotask(() => {
          this.onopen?.(new Event('open'));
        });
      }

      addEventListener(type: string, listener: unknown) {
        const handler = typeof listener === 'function'
          ? listener as (event: MessageEvent) => void
          : (listener as { handleEvent: (event: MessageEvent) => void }).handleEvent;

        const current = this.listeners.get(type) ?? new Set<(event: MessageEvent) => void>();
        current.add(handler);
        this.listeners.set(type, current);
      }

      removeEventListener(type: string, listener: unknown) {
        const handler = typeof listener === 'function'
          ? listener as (event: MessageEvent) => void
          : (listener as { handleEvent: (event: MessageEvent) => void }).handleEvent;

        this.listeners.get(type)?.delete(handler);
      }

      close() {
        this.readyState = MockEventSource.CLOSED;
      }
    }

    Object.defineProperty(globalThis, 'EventSource', {
      configurable: true,
      writable: true,
      value: MockEventSource,
    });
  });
};

const installAuthenticatedAdminApi = async (page: Page) => {
  const auditRequestUrls: string[] = [];
  const invalidatedMembers: string[] = [];

  await installMockEventSource(page);

  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const pathname = url.pathname;

    if (pathname === '/api/v1/auth/csrf' && request.method() === 'GET') {
      await fulfillJson(route, 200, successEnvelope({
        csrfToken: 'csrf-admin-monitoring-e2e',
        headerName: 'X-CSRF-TOKEN',
      }));
      return;
    }

    if (pathname === '/api/v1/auth/session' && request.method() === 'GET') {
      await fulfillJson(route, 200, successEnvelope(adminMemberFixture));
      return;
    }

    if (pathname === '/api/v1/notifications' && request.method() === 'GET') {
      await fulfillJson(route, 200, successEnvelope({
        items: [],
      }));
      return;
    }

    if (pathname === '/api/v1/admin/audit-logs' && request.method() === 'GET') {
      auditRequestUrls.push(request.url());

      const eventType = url.searchParams.get('eventType');

      if (eventType === 'ORDER_EXECUTE') {
        await fulfillJson(route, 200, successEnvelope({
          content: [
            {
              auditId: 'log-order-execute',
              memberUuid: 'member-001',
              email: 'member-001@example.com',
              eventType: 'ORDER_EXECUTE',
              ipAddress: '127.0.0.1',
              userAgent: 'playwright',
              description: 'executed from monitoring drill-down',
              clOrdId: 'cl-001',
              orderSessionId: 'session-001',
              createdAt: '2026-03-24T09:16:00Z',
            },
          ],
          totalElements: 1,
          totalPages: 1,
          number: 0,
          size: 20,
        }));
        return;
      }

      await fulfillJson(route, 200, successEnvelope({
        content: [
          {
            auditId: 'log-baseline',
            memberUuid: 'member-admin-001',
            email: 'ops-admin@fix.com',
            eventType: 'LOGIN_SUCCESS',
            ipAddress: '127.0.0.1',
            userAgent: 'playwright',
            description: 'baseline audit row',
            clOrdId: null,
            orderSessionId: null,
            createdAt: '2026-03-24T09:10:00Z',
          },
        ],
        totalElements: 1,
        totalPages: 1,
        number: 0,
        size: 20,
      }));
      return;
    }

    if (
      pathname.startsWith('/api/v1/admin/members/')
      && pathname.endsWith('/sessions')
      && request.method() === 'DELETE'
    ) {
      const memberUuid = decodeURIComponent(pathname.split('/')[5] ?? '');
      invalidatedMembers.push(memberUuid);

      await fulfillJson(route, 200, successEnvelope({
        memberUuid,
        invalidatedCount: 1,
        message: '세션이 무효화되었습니다.',
      }));
      return;
    }

    await fulfillJson(
      route,
      404,
      directErrorPayload(
        'SYS-404',
        `Unhandled request: ${pathname}`,
        pathname,
        'corr-admin-monitoring-e2e',
      ),
    );
  });

  return {
    auditRequestUrls,
    invalidatedMembers,
  };
};

const installAnonymousApi = async (page: Page) => {
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;

    if (pathname === '/api/v1/auth/csrf' && request.method() === 'GET') {
      await fulfillJson(route, 200, successEnvelope({
        csrfToken: 'csrf-anon-admin-monitoring-e2e',
        headerName: 'X-CSRF-TOKEN',
      }));
      return;
    }

    if (pathname === '/api/v1/auth/session' && request.method() === 'GET') {
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

    await fulfillJson(
      route,
      404,
      directErrorPayload(
        'SYS-404',
        `Unhandled request: ${pathname}`,
        pathname,
        'corr-admin-monitoring-anon-e2e',
      ),
    );
  });
};

test.describe('admin monitoring dashboard e2e', () => {
  test('shows monitoring cards and keeps admin actions wired together', async ({ page }) => {
    const { auditRequestUrls, invalidatedMembers } = await installAuthenticatedAdminApi(page);

    await page.goto('/admin');

    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByTestId('topbar-admin-link')).toBeVisible();
    await expect(page.getByTestId('admin-console-title')).toContainText('운영자 보안 및 모니터링 콘솔');
    await expect(page.getByTestId('admin-monitoring-card-executionVolume')).toBeVisible();
    await expect(page.getByTestId('admin-monitoring-status-executionVolume')).toContainText('Freshness OK');
    await expect(page.getByTestId('admin-monitoring-last-updated-pendingSessions')).toContainText('Last updated');
    await expect(page.getByTestId('admin-monitoring-open-executionVolume')).toHaveAttribute(
      'href',
      'https://grafana.fix.local/d/ops/exec-volume',
    );
    await expect(page.getByTestId('admin-monitoring-embed-marketDataIngest')).toHaveAttribute(
      'src',
      'https://grafana.fix.local/d-solo/ops/market-data?panelId=13',
    );
    await expect(page.getByTestId('admin-audit-row-log-baseline')).toContainText('baseline audit row');

    await page.getByTestId('admin-force-member-uuid').fill('member-001');
    await page.getByTestId('admin-force-submit').click();

    await expect(page.getByTestId('admin-force-feedback')).toContainText(
      '세션이 무효화되었습니다. (무효화된 세션: 1건)',
    );
    expect(invalidatedMembers).toEqual(['member-001']);

    await page.getByTestId('admin-monitoring-audit-executionVolume').click();

    await expect(page).toHaveURL(/\/admin\?auditEventType=ORDER_EXECUTE$/);
    await expect(page.getByTestId('admin-audit-event-type')).toHaveValue('ORDER_EXECUTE');
    await expect(page.getByTestId('admin-audit-row-log-order-execute')).toContainText(
      'executed from monitoring drill-down',
    );
    expect(
      auditRequestUrls.some(
        (requestUrl) => new URL(requestUrl).searchParams.get('eventType') === 'ORDER_EXECUTE',
      ),
    ).toBe(true);
  });

  test('blocks anonymous access to admin monitoring and preserves the redirect target', async ({ page }) => {
    await installAnonymousApi(page);

    await page.goto('/admin?auditEventType=ORDER_EXECUTE');

    await expect(page).toHaveURL(
      /\/login\?redirect=%2Fadmin%3FauditEventType%3DORDER_EXECUTE$/,
    );
    await expect(page.getByTestId('login-email')).toBeVisible();
    await expect(page.getByTestId('login-submit')).toBeVisible();
  });
});
