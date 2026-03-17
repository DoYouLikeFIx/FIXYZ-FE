import { expect, test, type Page, type Route } from '@playwright/test';

const successEnvelope = <T,>(data: T) => ({
  success: true,
  data,
  error: null,
});

const errorEnvelope = (code: string, message: string, detail: string) => ({
  success: false,
  data: null,
  error: {
    code,
    message,
    detail,
    timestamp: '2026-03-17T00:00:00.000Z',
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
      static OPEN = 1;

      static CLOSED = 2;

      static instances: MockEventSource[] = [];

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
        MockEventSource.instances.push(this);
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

      emit(type: string, payload: unknown) {
        const event = new MessageEvent(type, {
          data: typeof payload === 'string' ? payload : JSON.stringify(payload),
        });

        if (type === 'message') {
          this.onmessage?.(event);
        }

        const handlers = this.listeners.get(type);
        handlers?.forEach((handler) => {
          handler(event);
        });
      }

      emitError() {
        this.onerror?.(new Event('error'));
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

    Object.defineProperty(globalThis, '__mockEventSourceInstances', {
      configurable: true,
      writable: true,
      value: MockEventSource.instances,
    });
  });
};

test.describe('notification center e2e', () => {
  test('shows feed items, handles live stream updates, and marks notifications as read', async ({ page }) => {
    await installMockEventSource(page);

    const markReadIds: number[] = [];

    await page.route('**/api/v1/**', async (route) => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;

      if (pathname === '/api/v1/auth/csrf' && request.method() === 'GET') {
        await fulfillJson(route, 200, successEnvelope({
          csrfToken: 'csrf-token',
          headerName: 'X-CSRF-TOKEN',
        }));
        return;
      }

      if (pathname === '/api/v1/auth/session' && request.method() === 'GET') {
        await fulfillJson(route, 200, successEnvelope({
          memberUuid: 'member-001',
          email: 'demo@fix.com',
          name: 'Demo User',
          role: 'ROLE_USER',
          totpEnrolled: true,
          accountId: '1',
        }));
        return;
      }

      if (pathname === '/api/v1/accounts/1/summary' && request.method() === 'GET') {
        await fulfillJson(route, 200, successEnvelope({
          accountId: 1,
          symbol: '005930',
          quantity: 2,
          availableQuantity: 2,
          balance: 1000000,
          asOf: '2026-03-17T00:00:00Z',
        }));
        return;
      }

      if (pathname === '/api/v1/accounts/1/positions/list' && request.method() === 'GET') {
        await fulfillJson(route, 200, successEnvelope([
          {
            accountId: 1,
            symbol: '005930',
            quantity: 2,
            availableQuantity: 2,
            balance: 1000000,
            asOf: '2026-03-17T00:00:00Z',
          },
        ]));
        return;
      }

      if (pathname === '/api/v1/notifications' && request.method() === 'GET') {
        await fulfillJson(route, 200, successEnvelope({
          items: [
            {
              notificationId: 101,
              channel: 'ORDER_SESSION',
              message: 'Initial order update',
              delivered: true,
              read: false,
              readAt: null,
            },
          ],
        }));
        return;
      }

      if (/\/api\/v1\/notifications\/\d+\/read$/.test(pathname) && request.method() === 'PATCH') {
        const notificationId = Number(pathname.split('/').at(-2));
        markReadIds.push(notificationId);

        await fulfillJson(route, 200, successEnvelope({
          notificationId,
          channel: 'ORDER_SESSION',
          message: notificationId === 202 ? 'Live order update' : 'Initial order update',
          delivered: true,
          read: true,
          readAt: '2026-03-17T00:01:00Z',
        }));
        return;
      }

      await fulfillJson(route, 404, errorEnvelope('SYS-404', `Unhandled request: ${pathname}`, 'Missing route handler in test'));
    });

    await page.goto('/portfolio');
    await expect(page).toHaveURL(/\/portfolio$/);
    await expect(page.getByTestId('notification-center')).toBeVisible();
    await expect(page.getByTestId('notification-item-101')).toContainText('Initial order update');

    await expect.poll(async () => page.evaluate(() => {
      const instances = (globalThis as unknown as { __mockEventSourceInstances?: unknown[] }).__mockEventSourceInstances;
      return Array.isArray(instances) ? instances.length : 0;
    })).toBe(1);

    await page.evaluate(() => {
      const bag = globalThis as unknown as {
        __mockEventSourceInstances?: Array<{ emit: (type: string, payload: unknown) => void }>;
      };
      const stream = bag.__mockEventSourceInstances?.at(-1);

      if (!stream) {
        throw new Error('Expected one active mock EventSource instance.');
      }

      stream.emit('notification', {
        notificationId: 202,
        channel: 'ORDER_SESSION',
        message: 'Live order update',
        delivered: true,
        read: false,
        readAt: null,
      });
    });

    await expect(page.getByTestId('notification-item-202')).toContainText('Live order update');
    await page.getByTestId('notification-mark-read-202').click();
    await expect(page.getByTestId('notification-read-202')).toHaveText('Read');

    expect(markReadIds).toEqual([202]);
  });

  test('recovers notification feed via Refresh feed after reconnect-triggered hydration failure', async ({ page }) => {
    await installMockEventSource(page);

    let notificationFetchCount = 0;

    await page.route('**/api/v1/**', async (route) => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;

      if (pathname === '/api/v1/auth/csrf' && request.method() === 'GET') {
        await fulfillJson(route, 200, successEnvelope({
          csrfToken: 'csrf-token',
          headerName: 'X-CSRF-TOKEN',
        }));
        return;
      }

      if (pathname === '/api/v1/auth/session' && request.method() === 'GET') {
        await fulfillJson(route, 200, successEnvelope({
          memberUuid: 'member-001',
          email: 'demo@fix.com',
          name: 'Demo User',
          role: 'ROLE_USER',
          totpEnrolled: true,
          accountId: '1',
        }));
        return;
      }

      if (pathname === '/api/v1/accounts/1/summary' && request.method() === 'GET') {
        await fulfillJson(route, 200, successEnvelope({
          accountId: 1,
          symbol: '005930',
          quantity: 2,
          availableQuantity: 2,
          balance: 1000000,
          asOf: '2026-03-17T00:00:00Z',
        }));
        return;
      }

      if (pathname === '/api/v1/accounts/1/positions/list' && request.method() === 'GET') {
        await fulfillJson(route, 200, successEnvelope([
          {
            accountId: 1,
            symbol: '005930',
            quantity: 2,
            availableQuantity: 2,
            balance: 1000000,
            asOf: '2026-03-17T00:00:00Z',
          },
        ]));
        return;
      }

      if (pathname === '/api/v1/notifications' && request.method() === 'GET') {
        notificationFetchCount += 1;

        if (notificationFetchCount === 2) {
          await fulfillJson(route, 500, errorEnvelope('SYS-500', 'Notification fetch failed', 'Reconnect hydration failed'));
          return;
        }

        await fulfillJson(route, 200, successEnvelope({
          items: notificationFetchCount >= 3
            ? [
                {
                  notificationId: 303,
                  channel: 'ORDER_SESSION',
                  message: 'Recovered notification after manual refresh',
                  delivered: true,
                  read: false,
                  readAt: null,
                },
              ]
            : [
                {
                  notificationId: 101,
                  channel: 'ORDER_SESSION',
                  message: 'Initial order update',
                  delivered: true,
                  read: false,
                  readAt: null,
                },
              ],
        }));
        return;
      }

      await fulfillJson(route, 404, errorEnvelope('SYS-404', `Unhandled request: ${pathname}`, 'Missing route handler in test'));
    });

    await page.goto('/portfolio');
    await expect(page).toHaveURL(/\/portfolio$/);
    await expect(page.getByTestId('notification-item-101')).toContainText('Initial order update');

    await page.evaluate(() => {
      const bag = globalThis as unknown as {
        __mockEventSourceInstances?: Array<{ emitError: () => void }>;
      };
      const stream = bag.__mockEventSourceInstances?.at(-1);

      if (!stream) {
        throw new Error('Expected one active mock EventSource instance before reconnect failure.');
      }

      stream.emitError();
    });

    await expect.poll(async () => page.evaluate(() => {
      const instances = (globalThis as unknown as { __mockEventSourceInstances?: unknown[] }).__mockEventSourceInstances;
      return Array.isArray(instances) ? instances.length : 0;
    }), { timeout: 10_000 }).toBe(2);

    await expect(page.getByTestId('notification-feed-unavailable')).toContainText(
      'Notification feed is temporarily unavailable. Pull to refresh shortly.',
    );

    await page.getByTestId('notification-feed-refresh').click();
    await expect(page.getByTestId('notification-item-303')).toContainText(
      'Recovered notification after manual refresh',
    );
    await expect(page.getByTestId('notification-feed-unavailable')).toHaveCount(0);
  });
});
