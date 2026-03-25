import { createHmac } from 'node:crypto';

import { expect, test, type Page } from '@playwright/test';

import { primeLiveBrowserCsrf, requireLiveAuthContractHealthy } from './_shared/liveAuthContract';

const isLiveConfigured = Boolean(process.env.LIVE_API_BASE_URL?.trim());
const DEFAULT_REGISTER_PASSWORD = 'LiveNotificationCenter1!';
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const liveLoginEmail = process.env.LIVE_LOGIN_EMAIL?.trim();
const liveLoginPassword = process.env.LIVE_LOGIN_PASSWORD?.trim();
const liveLoginOtp = process.env.LIVE_LOGIN_OTP?.trim();
const liveLoginTotpSecret = process.env.LIVE_LOGIN_TOTP_SECRET?.trim();
const protectedStatuses = [401, 403, 410];

const createLiveIdentity = () => {
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;

  return {
    email: `notification_center_live_${suffix}@example.com`,
    name: `Notification Center ${suffix}`,
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

const loginWithLiveAccount = async (page: Page) => {
  if (!liveLoginEmail || !liveLoginPassword) {
    return false;
  }

  await goToLogin(page);
  await page.getByTestId('login-email').fill(liveLoginEmail);
  await page.getByTestId('login-password').fill(liveLoginPassword);
  await page.getByTestId('login-submit').click();

  const mfaInput = page.getByTestId('login-mfa-input');
  const loginError = page.getByTestId('error-message');
  const loginStep = await waitForLoginStep(page);

  if (loginStep === 'error') {
    const message = (await loginError.textContent())?.trim() ?? 'Unknown login error';
    throw new Error(`Live account password login failed before MFA: ${message}`);
  }

  if (loginStep === 'mfa') {
    if (!liveLoginOtp && !liveLoginTotpSecret) {
      throw new Error('LIVE_LOGIN_OTP or LIVE_LOGIN_TOTP_SECRET is required when live account login prompts MFA verification.');
    }

    const maxAttempts = liveLoginTotpSecret ? 3 : 1;
    let previousCode = '';
    let mfaPassed = false;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const mfaCode = liveLoginTotpSecret
        ? (attempt === 1
          ? generateTotp(liveLoginTotpSecret)
          : await waitForNextTotp(liveLoginTotpSecret, previousCode))
        : liveLoginOtp!;

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

  await page.context().clearCookies();
  await page.evaluate(() => {
    globalThis.localStorage?.clear();
    globalThis.sessionStorage.clear();
  });

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

test.describe.serial('live notification center smoke', () => {
  test.beforeEach(async ({ request }) => {
    await requireLiveAuthContractHealthy(request);
  });

  test('enforces auth boundary for notification-center entry points against live backend', async ({
    page,
  }) => {
    test.skip(
      !isLiveConfigured,
      'LIVE_API_BASE_URL is required for live notification-center smoke execution.',
    );

    await page.goto('/portfolio');
    await expect(page).toHaveURL(/\/login/);

    const notificationListResponse = await page.request.get('/api/v1/notifications?limit=20');
    const notificationStreamResponse = await page.request.get('/api/v1/notifications/stream');

    expect(protectedStatuses).toContain(notificationListResponse.status());
    expect(protectedStatuses).toContain(notificationStreamResponse.status());
  });

  test('hydrates notification center and marks a live notification as read after order completion', async ({
    page,
  }) => {
    test.skip(
      !isLiveConfigured,
      'LIVE_API_BASE_URL is required for live notification-center smoke execution.',
    );
    test.slow();
    test.setTimeout(180_000);

    const usedLiveAccount = await loginWithLiveAccount(page);

    if (!usedLiveAccount) {
      await registerEnrollAndLoginToOrders(page);
    }

    await expect(page.getByTestId('notification-center')).toBeVisible();

    const notificationItems = page.locator('[data-testid^="notification-item-"]');
    const initialNotificationCount = await notificationItems.count();

    await page.getByTestId('order-session-create').click();
    await expect(page.getByTestId('order-session-summary')).toContainText('상태 AUTHED');
    await page.getByTestId('order-session-execute').click();
    await expect(page.getByTestId('order-session-summary')).toContainText('상태 COMPLETED');

    await expect.poll(async () => notificationItems.count(), {
      timeout: 45_000,
      message: 'Expected notification center to receive a new live notification after order completion.',
    }).toBeGreaterThan(initialNotificationCount);

    const unreadButton = page.locator('[data-testid^="notification-mark-read-"]').first();
    await expect(unreadButton).toBeVisible();

    const buttonTestId = await unreadButton.getAttribute('data-testid');
    const notificationId = buttonTestId?.match(/^notification-mark-read-(\d+)$/)?.[1];

    expect(notificationId).toBeTruthy();

    await unreadButton.click();

    await expect(page.getByTestId(`notification-read-${notificationId}`)).toHaveText('Read');
  });
});
