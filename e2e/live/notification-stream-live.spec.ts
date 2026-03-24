import { createHmac } from 'node:crypto';

import {
  expect,
  test,
  type Page,
} from '@playwright/test';

import { primeLiveBrowserCsrf, requireLiveAuthContractHealthy } from './_shared/liveAuthContract';

const DEFAULT_REGISTER_PASSWORD = 'LiveNotification1!';
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const LIVE_LOGIN_EMAIL = process.env.LIVE_LOGIN_EMAIL?.trim();
const LIVE_LOGIN_PASSWORD = process.env.LIVE_LOGIN_PASSWORD?.trim();
const LIVE_LOGIN_OTP = process.env.LIVE_LOGIN_OTP?.trim();
const LIVE_LOGIN_TOTP_SECRET = process.env.LIVE_LOGIN_TOTP_SECRET?.trim();
const DIRECT_BACKEND_BASE_URL = process.env.LIVE_API_BASE_URL?.trim() ?? 'http://127.0.0.1:8080';

const createLiveIdentity = () => {
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;

  return {
    email: `notification_live_${suffix}@example.com`,
    name: `Notification Live ${suffix}`,
    password: process.env.LIVE_REGISTER_PASSWORD ?? DEFAULT_REGISTER_PASSWORD,
  };
};

const decodeBase32 = (value: string): Buffer => {
  const normalized = value.trim().replace(/[\s=-]/g, '').toUpperCase();
  let buffer = 0;
  let bitsLeft = 0;
  const output: number[] = [];

  for (const character of normalized) {
    const index = BASE32_ALPHABET.indexOf(character);

    if (index < 0) {
      throw new Error(`Unsupported base32 character: ${character}`);
    }

    buffer = (buffer << 5) | index;
    bitsLeft += 5;

    if (bitsLeft >= 8) {
      output.push((buffer >> (bitsLeft - 8)) & 0xff);
      bitsLeft -= 8;
    }
  }

  return Buffer.from(output);
};

const generateTotp = (manualEntryKey: string, now = Date.now()): string => {
  const counter = Math.floor(now / 1000 / 30);
  const counterBuffer = Buffer.alloc(8);

  counterBuffer.writeBigUInt64BE(BigInt(counter));

  const digest = createHmac('sha1', decodeBase32(manualEntryKey))
    .update(counterBuffer)
    .digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24)
    | ((digest[offset + 1] & 0xff) << 16)
    | ((digest[offset + 2] & 0xff) << 8)
    | (digest[offset + 3] & 0xff);

  return String(binary % 1_000_000).padStart(6, '0');
};

const delay = (milliseconds: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });

const millisUntilNextTotpWindow = (now = Date.now()) => 30_000 - (now % 30_000);

const waitForNextTotp = async (
  manualEntryKey: string,
  previousCode: string,
): Promise<string> => {
  const startedAt = Date.now();
  let nextCode = generateTotp(manualEntryKey);

  while (nextCode === previousCode || millisUntilNextTotpWindow() < 10_000) {
    if (Date.now() - startedAt > 45_000) {
      throw new Error('Timed out waiting for the next TOTP window.');
    }

    await delay(250);
    nextCode = generateTotp(manualEntryKey);
  }

  return nextCode;
};

const waitForLoginStep = async (page: Page): Promise<'orders' | 'mfa' | 'error'> => {
  const mfaInput = page.getByTestId('login-mfa-input');
  const loginError = page.getByTestId('error-message');
  const startedAt = Date.now();

  while (Date.now() - startedAt <= 15_000) {
    const pathname = new URL(page.url()).pathname;

    if (pathname === '/orders') {
      return 'orders';
    }

    if (await mfaInput.isVisible().catch(() => false)) {
      return 'mfa';
    }

    if (await loginError.isVisible().catch(() => false)) {
      return 'error';
    }

    await delay(250);
  }

  throw new Error('Expected login to reach /orders, show MFA challenge, or show a login error message within 15s.');
};

const tryRefreshNotificationFeed = async (page: Page) => {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const unavailableCount = await page.getByTestId('notification-feed-unavailable').count();

    if (unavailableCount === 0) {
      return;
    }

    await page.getByTestId('notification-feed-refresh').click();
    await delay(1_500);
  }
};

interface NotificationNetworkTelemetry {
  streamStatuses: number[];
  streamContentTypes: string[];
  listStatuses: number[];
  listItemCounts: number[];
  listRequestUrls: string[];
  executeStatuses: number[];
  directBackendListStatuses: number[];
  directBackendStreamStatuses: number[];
}

const createNotificationNetworkTelemetry = (): NotificationNetworkTelemetry => ({
  streamStatuses: [],
  streamContentTypes: [],
  listStatuses: [],
  listItemCounts: [],
  listRequestUrls: [],
  executeStatuses: [],
  directBackendListStatuses: [],
  directBackendStreamStatuses: [],
});

const attachNotificationNetworkTelemetry = (
  page: Page,
  telemetry: NotificationNetworkTelemetry,
) => {
  page.on('response', async (response) => {
    const url = response.url();
    const method = response.request().method();

    if (method === 'GET' && url.includes('/api/v1/notifications/stream')) {
      telemetry.streamStatuses.push(response.status());
      telemetry.streamContentTypes.push(response.headers()['content-type'] ?? '');
      return;
    }

    if (method === 'GET' && url.includes('/api/v1/notifications')) {
      telemetry.listStatuses.push(response.status());
      telemetry.listRequestUrls.push(url);

      try {
        const payload = await response.json() as { items?: unknown[] };
        telemetry.listItemCounts.push(Array.isArray(payload.items) ? payload.items.length : -1);
      } catch {
        telemetry.listItemCounts.push(-1);
      }

      return;
    }

    if (
      method === 'POST'
      && url.includes('/api/v1/orders/sessions')
      && url.includes('/execute')
    ) {
      telemetry.executeStatuses.push(response.status());
    }
  });
};

const clearBrowserSession = async (page: Page) => {
  await page.context().clearCookies();
  await page.evaluate(() => {
    globalThis.localStorage?.clear();
    globalThis.sessionStorage.clear();
  });
};

const goToRegister = async (page: Page) => {
  await page.goto('/register?redirect=/orders');
  await expect(page.getByTestId('register-email')).toBeVisible();
  await primeLiveBrowserCsrf(page);
};

const goToLogin = async (page: Page) => {
  await page.goto('/login?redirect=/orders');
  await expect(page.getByTestId('login-email')).toBeVisible();
  await primeLiveBrowserCsrf(page);
};

const expectOrdersPath = async (page: Page) => {
  await expect.poll(() => {
    const url = new URL(page.url());
    return url.pathname;
  }, {
    timeout: 20_000,
    message: 'Expected browser to navigate to /orders pathname.',
  }).toBe('/orders');
};

const buildCookieHeaderFromContext = async (page: Page): Promise<string> => {
  const cookies = await page.context().cookies();
  return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
};

const checkDirectBackendNotificationEndpoints = async (
  page: Page,
  telemetry: NotificationNetworkTelemetry,
) => {
  const cookieHeader = await buildCookieHeaderFromContext(page);

  const listResponse = await page.request.get(
    `${DIRECT_BACKEND_BASE_URL}/api/v1/notifications?limit=20`,
    {
      headers: cookieHeader ? { cookie: cookieHeader } : undefined,
      timeout: 10_000,
    },
  );
  telemetry.directBackendListStatuses.push(listResponse.status());

  try {
    const streamResponse = await page.request.get(
      `${DIRECT_BACKEND_BASE_URL}/api/v1/notifications/stream`,
      {
        headers: cookieHeader ? { cookie: cookieHeader } : undefined,
        timeout: 10_000,
      },
    );
    telemetry.directBackendStreamStatuses.push(streamResponse.status());
  } catch (error) {
    const message = String(error);

    // SSE endpoints can keep the connection open; Playwright may timeout after headers were accepted.
    if (message.includes('← 200')) {
      telemetry.directBackendStreamStatuses.push(200);
      return;
    }

    telemetry.directBackendStreamStatuses.push(-1);
  }
};

const loginWithLiveAccount = async (page: Page) => {
  if (!LIVE_LOGIN_EMAIL || !LIVE_LOGIN_PASSWORD) {
    return false;
  }

  await goToLogin(page);
  await page.getByTestId('login-email').fill(LIVE_LOGIN_EMAIL);
  await page.getByTestId('login-password').fill(LIVE_LOGIN_PASSWORD);
  await page.getByTestId('login-submit').click();

  const mfaInput = page.getByTestId('login-mfa-input');
  const loginError = page.getByTestId('error-message');
  const loginStep = await waitForLoginStep(page);

  if (loginStep === 'error') {
    const message = (await loginError.textContent())?.trim() ?? 'Unknown login error';
    throw new Error(`Live account password login failed before MFA: ${message}`);
  }

  if (loginStep === 'mfa') {
    if (!LIVE_LOGIN_OTP && !LIVE_LOGIN_TOTP_SECRET) {
      throw new Error('LIVE_LOGIN_OTP or LIVE_LOGIN_TOTP_SECRET is required when live account login prompts MFA verification.');
    }

    const maxAttempts = LIVE_LOGIN_TOTP_SECRET ? 3 : 1;
    let previousCode = '';
    let mfaPassed = false;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const mfaCode = LIVE_LOGIN_TOTP_SECRET
        ? (attempt === 1
          ? generateTotp(LIVE_LOGIN_TOTP_SECRET)
          : await waitForNextTotp(LIVE_LOGIN_TOTP_SECRET, previousCode))
        : LIVE_LOGIN_OTP!;

      previousCode = mfaCode;
      await mfaInput.fill(mfaCode);
      await page.getByTestId('login-mfa-submit').click();

      const reachedOrders = await expect.poll(() => {
        const url = new URL(page.url());
        return url.pathname === '/orders';
      }, {
        timeout: 8_000,
        message: `Expected browser to navigate to /orders after MFA attempt ${attempt}.`,
      }).toBeTruthy().then(() => true).catch(() => false);

      if (reachedOrders) {
        mfaPassed = true;
        break;
      }
    }

    if (!mfaPassed) {
      const message = await page.getByTestId('login-mfa-error').textContent().catch(() => null);
      throw new Error(`Live account MFA verification did not complete. ${message?.trim() ? `Server message: ${message.trim()}` : 'Check LIVE_LOGIN_TOTP_SECRET/LIVE_LOGIN_OTP validity and server clock skew.'}`);
    }
  }

  await expectOrdersPath(page);
  await expect(page.getByTestId('protected-area-title')).toHaveText('Session-based order flow');
  return true;
};

const registerEnrollAndLoginToOrders = async (page: Page) => {
  const identity = createLiveIdentity();

  await goToRegister(page);
  await page.getByTestId('register-email').fill(identity.email);
  await page.getByTestId('register-name').fill(identity.name);
  await page.getByTestId('register-password').fill(identity.password);
  await page.getByTestId('register-password-confirm').fill(identity.password);

  const registerLoginResponsePromise = page.waitForResponse(
    (response) =>
      response.url().includes('/api/v1/auth/login')
      && response.request().method() === 'POST',
  );
  await page.getByTestId('register-submit').click();

  const registerLoginResponse = await registerLoginResponsePromise;
  const registerLoginPayload = await registerLoginResponse.json() as {
    data?: {
      nextAction?: string;
    };
  };

  expect(registerLoginPayload.data?.nextAction).toBe('ENROLL_TOTP');
  await expect(page).toHaveURL(/\/settings\/totp\/enroll(?:\?.*)?$/);
  await expect(page.getByTestId('totp-enroll-manual-key')).toBeVisible();

  const manualEntryKey = (await page.getByTestId('totp-enroll-manual-key').textContent())?.trim();
  expect(manualEntryKey).toBeTruthy();

  const enrollmentCode = generateTotp(manualEntryKey!);
  await page.getByTestId('totp-enroll-code').fill(enrollmentCode);
  await page.getByTestId('totp-enroll-submit').click();

  await expect(page.getByTestId('protected-area-title')).toBeVisible();

  await clearBrowserSession(page);
  await goToLogin(page);
  await page.getByTestId('login-email').fill(identity.email);
  await page.getByTestId('login-password').fill(identity.password);

  const loginChallengeResponsePromise = page.waitForResponse(
    (response) =>
      response.url().includes('/api/v1/auth/login')
      && response.request().method() === 'POST',
  );
  await page.getByTestId('login-submit').click();

  const loginChallengeResponse = await loginChallengeResponsePromise;
  const loginChallengePayload = await loginChallengeResponse.json() as {
    data?: {
      nextAction?: string;
    };
  };

  if (loginChallengePayload.data?.nextAction === 'VERIFY_TOTP') {
    await expect(page.getByTestId('login-mfa-input')).toBeVisible();
    const loginCode = await waitForNextTotp(manualEntryKey!, enrollmentCode);
    await page.getByTestId('login-mfa-input').fill(loginCode);
    await page.getByTestId('login-mfa-submit').click();
  }

  await expectOrdersPath(page);
  await expect(page.getByTestId('protected-area-title')).toHaveText('Session-based order flow');
};

test.describe.serial('live backend notification stream', () => {
  test.beforeEach(async ({ request }) => {
    await requireLiveAuthContractHealthy(request);
  });

  test('receives a new notification in the live feed after order completion without manual refresh', async ({
    page,
  }) => {
    test.slow();
    test.setTimeout(180_000);

    const usedLiveAccount = await loginWithLiveAccount(page);

    if (!usedLiveAccount) {
      await registerEnrollAndLoginToOrders(page);
    }

    const telemetry = createNotificationNetworkTelemetry();
    attachNotificationNetworkTelemetry(page, telemetry);
    await checkDirectBackendNotificationEndpoints(page, telemetry);

    await expect(page.getByTestId('notification-center')).toBeVisible();
    await tryRefreshNotificationFeed(page);

    const notificationItems = page.locator('[data-testid^="notification-item-"]');
    const initialNotificationCount = await notificationItems.count();

    await page.getByTestId('order-session-create').click();
    await expect(page.getByTestId('order-session-summary')).toContainText('상태 AUTHED');

    await page.getByTestId('order-session-execute').click();
    await expect(page.getByTestId('order-session-summary')).toContainText('상태 COMPLETED');

    let streamObservedCount = initialNotificationCount;

    try {
      await expect.poll(async () => notificationItems.count(), {
        timeout: 45_000,
        message: 'Expected live notification stream to append a new notification item.',
      }).toBeGreaterThan(initialNotificationCount);

      streamObservedCount = await notificationItems.count();
    } catch {
      streamObservedCount = await notificationItems.count();

      // Diagnostic branch: if manual refresh increases count, SSE propagation is likely at fault.
      if (await page.getByTestId('notification-feed-refresh').count() > 0) {
        await page.getByTestId('notification-feed-refresh').click();
        await delay(2_000);
      }

      const refreshedCount = await notificationItems.count();
      const streamConnected = telemetry.streamStatuses.some((status) => status >= 200 && status < 300);
      const manualBackfillWorked = refreshedCount > initialNotificationCount;
      const listRouteBroken = telemetry.listStatuses.length > 0
        && telemetry.listStatuses.every((status) => status === 404);
      const streamRouteBroken = telemetry.streamStatuses.length > 0
        && telemetry.streamStatuses.every((status) => status >= 400);
      const likelyFrontendOriginRoute = telemetry.listRequestUrls.length > 0
        && telemetry.listRequestUrls.every((url) => url.includes('127.0.0.1:4173/api/v1/notifications'));
      const directBackendHealthy = telemetry.directBackendListStatuses.some((status) => status >= 200 && status < 300)
        || telemetry.directBackendStreamStatuses.some((status) => status >= 200 && status < 300);

      const classification = listRouteBroken && streamRouteBroken && likelyFrontendOriginRoute
        ? (
            directBackendHealthy
              ? 'Vite proxy routing mismatch suspected (direct backend checks are healthy but frontend-origin notification endpoints return 4xx).'
              : 'Routing/proxy misconfiguration suspected (notification API/SSE endpoints returning 4xx on frontend origin).'
          )
        : manualBackfillWorked
          ? 'SSE propagation issue suspected (manual backfill increased item count).'
          : 'Notification generation/backfill issue suspected (manual refresh did not increase item count).';

      throw new Error([
        classification,
        `initialCount=${initialNotificationCount}`,
        `streamObservedCount=${streamObservedCount}`,
        `refreshedCount=${refreshedCount}`,
        `streamConnected=${streamConnected}`,
        `streamStatuses=${JSON.stringify(telemetry.streamStatuses)}`,
        `streamContentTypes=${JSON.stringify(telemetry.streamContentTypes)}`,
        `listStatuses=${JSON.stringify(telemetry.listStatuses)}`,
        `listItemCounts=${JSON.stringify(telemetry.listItemCounts)}`,
        `executeStatuses=${JSON.stringify(telemetry.executeStatuses)}`,
        `directBackendListStatuses=${JSON.stringify(telemetry.directBackendListStatuses)}`,
        `directBackendStreamStatuses=${JSON.stringify(telemetry.directBackendStreamStatuses)}`,
        `listRequestUrls=${JSON.stringify(telemetry.listRequestUrls)}`,
        `usedLiveAccount=${usedLiveAccount}`,
        `directBackendBaseUrl=${DIRECT_BACKEND_BASE_URL}`,
      ].join(' | '));
    }

    await expect(notificationItems.first()).toBeVisible();
  });
});
