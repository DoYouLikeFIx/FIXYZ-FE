import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect, test, type Page } from '@playwright/test';

const DEFAULT_REGISTER_PASSWORD = 'LiveOrder1!';
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const canonicalOrderSessionContract = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../../tests/order-session-contract-cases.json', import.meta.url)),
    'utf8',
  ),
) as {
  authorizationScenarios: Array<{
    scenarioKey: string;
    body: string;
  }>;
  finalResults: Array<{
    title: string;
    body: string;
  }>;
};

const authorizationScenario = (scenarioKey: string) => {
  const scenario = canonicalOrderSessionContract.authorizationScenarios.find(
    (candidate) => candidate.scenarioKey === scenarioKey,
  );

  if (!scenario) {
    throw new Error(`Missing authorization scenario: ${scenarioKey}`);
  }

  return scenario;
};

const isCanonicalFinalResult = (title: string, body: string) =>
  canonicalOrderSessionContract.finalResults.some(
    (candidate) => candidate.title === title && candidate.body === body,
  );

const createLiveIdentity = () => {
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;

  return {
    email: `order_live_${suffix}@example.com`,
    name: `Order Live ${suffix}`,
    password: process.env.LIVE_REGISTER_PASSWORD ?? DEFAULT_REGISTER_PASSWORD,
  };
};

const decodeBase32 = (value: string): Buffer => {
  const normalized = value.trim().replace(/=/g, '').toUpperCase();
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
};

const goToLogin = async (page: Page) => {
  await page.goto('/login?redirect=/orders');
  await expect(page.getByTestId('login-email')).toBeVisible();
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

  expect(loginChallengePayload.data?.nextAction).toBe('VERIFY_TOTP');
  await expect(page.getByTestId('login-mfa-input')).toBeVisible();
  const loginCode = await waitForNextTotp(manualEntryKey!, enrollmentCode);
  await page.getByTestId('login-mfa-input').fill(loginCode);
  await page.getByTestId('login-mfa-submit').click();

  await expect(page).toHaveURL(/\/orders$/);
  await expect(page.getByTestId('protected-area-title')).toHaveText('Session-based order flow');
  await expect(page.getByTestId('order-session-selected-summary')).toContainText('005930');

  return {
    manualEntryKey: manualEntryKey!,
    lastUsedTotp: loginCode,
  };
};

const expectCanonicalFinalResultCard = async (page: Page) => {
  const title = (await page.getByTestId('order-session-result-title').textContent())?.trim();
  const body = (await page.getByTestId('order-session-result-body').textContent())?.trim();

  expect(title).toBeTruthy();
  expect(body).toBeTruthy();
  expect(isCanonicalFinalResult(title!, body!)).toBe(true);
};

test.describe.serial('live backend order session flow', () => {
  test('creates and executes a low-risk order session after a fresh MFA login', async ({ page }) => {
    test.slow();
    test.setTimeout(150_000);

    await registerEnrollAndLoginToOrders(page);

    await page.getByTestId('order-session-create').click();

    await expect(page.getByTestId('order-session-execute')).toBeVisible();
    await expect(page.getByTestId('order-session-summary')).toContainText('상태 AUTHED');
    await expect(page.getByTestId('order-session-authorization-message')).toContainText(
      authorizationScenario('auto-authorized-confirm').body,
    );

    await page.getByTestId('order-session-execute').click();

    await expect(page.getByTestId('order-session-summary')).toContainText('상태 COMPLETED');
    await expect(page.getByTestId('order-session-result')).toBeVisible();
    await expectCanonicalFinalResultCard(page);
    await expect(page.getByTestId('external-order-feedback')).toHaveCount(0);
  });

  test('requires Step B for elevated-risk orders and maps same-window replay before recovering', async ({
    page,
  }) => {
    test.slow();
    test.setTimeout(180_000);

    const { manualEntryKey, lastUsedTotp } = await registerEnrollAndLoginToOrders(page);

    await page.getByTestId('external-order-preset-krx-buy-10').click();
    await expect(page.getByTestId('order-session-selected-summary')).toContainText('10주');

    await page.getByTestId('order-session-create').click();

    await expect(page.getByTestId('order-session-otp-input')).toBeVisible();
    await expect(page.getByTestId('order-session-summary')).toContainText('상태 PENDING_NEW');
    await expect(page.getByTestId('order-session-authorization-message')).toContainText(
      authorizationScenario('challenge-required-step-up').body,
    );

    const firstOrderOtpCode = await waitForNextTotp(manualEntryKey, lastUsedTotp);
    await page.getByTestId('order-session-otp-input').fill(firstOrderOtpCode);

    await expect(page.getByTestId('order-session-execute')).toBeVisible();
    await expect(page.getByTestId('order-session-summary')).toContainText('상태 AUTHED');

    await page.getByTestId('order-session-reset').click();
    await expect(page.getByTestId('order-session-create')).toBeVisible();

    await page.getByTestId('external-order-preset-krx-buy-10').click();
    await page.getByTestId('order-session-create').click();

    await expect(page.getByTestId('order-session-otp-input')).toBeVisible();
    await page.getByTestId('order-session-otp-input').fill(firstOrderOtpCode);

    await expect(page.getByTestId('order-session-error')).toContainText(
      '이미 사용한 OTP 코드입니다. 새 코드가 표시되면 다시 입력해 주세요.',
    );

    const recoveryOrderOtpCode = await waitForNextTotp(manualEntryKey, firstOrderOtpCode);
    await page.getByTestId('order-session-otp-input').fill(recoveryOrderOtpCode);

    await expect(page.getByTestId('order-session-execute')).toBeVisible();
    await expect(page.getByTestId('order-session-summary')).toContainText('상태 AUTHED');

    await page.getByTestId('order-session-execute').click();

    await expect(page.getByTestId('order-session-summary')).toContainText('상태 COMPLETED');
    await expect(page.getByTestId('order-session-result')).toBeVisible();
    await expectCanonicalFinalResultCard(page);
    await expect(page.getByTestId('external-order-feedback')).toHaveCount(0);
  });
});
