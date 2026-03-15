import { createHmac } from 'node:crypto';

import { expect, test, type Page } from '@playwright/test';

const DEFAULT_REGISTER_PASSWORD = 'LiveOrder1!';
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

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

const waitForNextTotp = async (
  manualEntryKey: string,
  previousCode: string,
): Promise<string> => {
  const startedAt = Date.now();
  let nextCode = generateTotp(manualEntryKey);

  while (nextCode === previousCode) {
    if (Date.now() - startedAt > 45_000) {
      throw new Error('Timed out waiting for the next TOTP window.');
    }

    await delay(250);
    nextCode = generateTotp(manualEntryKey);
  }

  return nextCode;
};

const goToRegister = async (page: Page) => {
  await page.goto('/register');
  await expect(page.getByTestId('register-email')).toBeVisible();
};

const goToLogin = async (page: Page) => {
  await page.goto('/login?redirect=/orders');
  await expect(page.getByTestId('login-email')).toBeVisible();
};

test.describe.serial('live backend order session flow', () => {
  const identity = createLiveIdentity();

  test('creates and executes a low-risk order session after a fresh MFA login', async ({ page }) => {
    test.slow();
    test.setTimeout(150_000);

    await goToRegister(page);
    await page.getByTestId('register-email').fill(identity.email);
    await page.getByTestId('register-name').fill(identity.name);
    await page.getByTestId('register-password').fill(identity.password);
    await page.getByTestId('register-password-confirm').fill(identity.password);
    await page.getByTestId('register-submit').click();

    await expect(page).toHaveURL(/\/settings\/totp\/enroll(?:\?.*)?$/);
    await expect(page.getByTestId('totp-enroll-manual-key')).toBeVisible();

    const manualEntryKey = (await page.getByTestId('totp-enroll-manual-key').textContent())?.trim();
    expect(manualEntryKey).toBeTruthy();

    const enrollmentCode = generateTotp(manualEntryKey!);
    await page.getByTestId('totp-enroll-code').fill(enrollmentCode);
    await page.getByTestId('totp-enroll-submit').click();

    await expect(page).toHaveURL(/\/portfolio$/);
    await expect(page.getByTestId('protected-area-title')).toHaveText('Portfolio overview');

    await page.context().clearCookies();
    await goToLogin(page);
    await page.evaluate(() => {
      globalThis.localStorage?.clear();
      globalThis.sessionStorage.clear();
    });

    await page.getByTestId('login-email').fill(identity.email);
    await page.getByTestId('login-password').fill(identity.password);
    await page.getByTestId('login-submit').click();

    await expect(page.getByTestId('login-mfa-input')).toBeVisible();
    const loginCode = await waitForNextTotp(manualEntryKey!, enrollmentCode);
    await page.getByTestId('login-mfa-input').fill(loginCode);
    await page.getByTestId('login-mfa-submit').click();

    await expect(page).toHaveURL(/\/orders$/);
    await expect(page.getByTestId('protected-area-title')).toHaveText('Session-based order flow');
    await expect(page.getByTestId('order-session-selected-summary')).toContainText('005930');

    await page.getByTestId('order-session-create').click();

    await expect(page.getByTestId('order-session-execute')).toBeVisible();
    await expect(page.getByTestId('order-session-summary')).toContainText('상태 AUTHED');
    await expect(page.getByTestId('order-session-authorization-message')).toContainText(
      '현재 신뢰 세션이 유효하여 추가 OTP 없이 바로 주문을 실행할 수 있습니다.',
    );

    await page.getByTestId('order-session-execute').click();

    await expect(page.getByTestId('order-session-summary')).toContainText('상태 COMPLETED');
    await expect(page.getByTestId('external-order-feedback')).toContainText(
      '주문이 접수되었습니다. 주문 요약을 확인해 주세요.',
    );
  });
});
