import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';

const projectRoot = path.resolve(process.cwd(), '..');
const videoDir = path.resolve(process.cwd(), 'test-results', 'notification-demo-video');
const outputDir = path.resolve(projectRoot, '_bmad-output', 'implementation-artifacts', 'demos');
const outputVideo = path.resolve(outputDir, '7-3-notification-center-compact.mp4');

const successEnvelope = (data) => ({
  success: true,
  data,
  error: null,
});

const errorEnvelope = (code, message, detail) => ({
  success: false,
  data: null,
  error: {
    code,
    message,
    detail,
    timestamp: '2026-03-17T00:00:00.000Z',
  },
});

const ensureDirs = async () => {
  await fs.mkdir(videoDir, { recursive: true });
  await fs.mkdir(outputDir, { recursive: true });
};

const installMockEventSource = async (page) => {
  await page.addInitScript(() => {
    class MockEventSource {
      static instances = [];

      constructor(url, init) {
        this.url = String(url);
        this.withCredentials = init?.withCredentials ?? false;
        this.readyState = 1;
        this.onopen = null;
        this.onerror = null;
        this.onmessage = null;
        this.listeners = new Map();
        MockEventSource.instances.push(this);
        queueMicrotask(() => {
          this.onopen?.(new Event('open'));
        });
      }

      addEventListener(type, listener) {
        const handler = typeof listener === 'function'
          ? listener
          : listener.handleEvent;
        const current = this.listeners.get(type) ?? new Set();
        current.add(handler);
        this.listeners.set(type, current);
      }

      removeEventListener(type, listener) {
        const handler = typeof listener === 'function'
          ? listener
          : listener.handleEvent;
        this.listeners.get(type)?.delete(handler);
      }

      emit(type, payload) {
        const event = new MessageEvent(type, {
          data: typeof payload === 'string' ? payload : JSON.stringify(payload),
        });

        if (type === 'message') {
          this.onmessage?.(event);
        }

        const handlers = this.listeners.get(type);
        handlers?.forEach((handler) => handler(event));
      }

      close() {
        this.readyState = 2;
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

const routeApi = async (page) => {
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;

    const fulfillJson = async (status, body) => {
      await route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(body),
      });
    };

    if (pathname === '/api/v1/auth/csrf' && request.method() === 'GET') {
      await fulfillJson(200, successEnvelope({ csrfToken: 'csrf-token', headerName: 'X-CSRF-TOKEN' }));
      return;
    }

    if (pathname === '/api/v1/auth/session' && request.method() === 'GET') {
      await fulfillJson(200, successEnvelope({
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
      await fulfillJson(200, successEnvelope({
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
      await fulfillJson(200, successEnvelope([
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
      await fulfillJson(200, successEnvelope({
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
      await fulfillJson(200, successEnvelope({
        notificationId,
        channel: 'ORDER_SESSION',
        message: notificationId === 202 ? 'Live order update' : 'Initial order update',
        delivered: true,
        read: true,
        readAt: '2026-03-17T00:01:00Z',
      }));
      return;
    }

    await fulfillJson(404, errorEnvelope('SYS-404', `Unhandled request: ${pathname}`, 'Missing route handler in recorder'));
  });
};

const findLatestVideo = async () => {
  const files = await fs.readdir(videoDir);
  const webmFiles = files.filter((name) => name.endsWith('.webm'));

  if (webmFiles.length === 0) {
    throw new Error('No recorded webm file found.');
  }

  const stats = await Promise.all(
    webmFiles.map(async (name) => {
      const fullPath = path.resolve(videoDir, name);
      const stat = await fs.stat(fullPath);
      return { fullPath, mtimeMs: stat.mtimeMs };
    }),
  );

  stats.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return stats[0].fullPath;
};

const main = async () => {
  await ensureDirs();

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1366, height: 768 },
    recordVideo: {
      dir: videoDir,
      size: { width: 1280, height: 720 },
    },
  });
  const page = await context.newPage();

  await installMockEventSource(page);
  await routeApi(page);

  await page.goto('http://127.0.0.1:4173/portfolio');
  await page.waitForSelector('[data-testid="notification-center"]');
  await page.waitForTimeout(600);

  await page.evaluate(() => {
    const stream = globalThis.__mockEventSourceInstances?.at(-1);
    if (!stream) {
      throw new Error('No active mock stream.');
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

  await page.waitForSelector('[data-testid="notification-item-202"]');
  await page.waitForTimeout(600);
  await page.click('[data-testid="notification-mark-read-202"]');
  await page.waitForSelector('[data-testid="notification-read-202"]');
  await page.waitForTimeout(1200);

  await context.close();
  await browser.close();

  const sourceVideo = await findLatestVideo();

  console.log(`SOURCE_VIDEO=${sourceVideo}`);
  console.log(`TARGET_VIDEO=${outputVideo}`);
};

await main();
