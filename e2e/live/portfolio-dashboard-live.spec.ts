import { createHmac } from 'node:crypto';

import { expect, test, type Page } from '@playwright/test';

const DEFAULT_REGISTER_PASSWORD = 'LiveTest1!';
const MASKED_ACCOUNT_PATTERN = /(^\*\*\*-[*\d]{4}$)|(^\d{3}-\*{4}-\d{4}$)/;
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

const createLiveIdentity = () => {
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;

  return {
    email: `portfolio_live_${suffix}@example.com`,
    name: `Portfolio Live ${suffix}`,
    password: process.env.LIVE_REGISTER_PASSWORD ?? DEFAULT_REGISTER_PASSWORD,
  };
};

const goToRegister = async (page: Page) => {
  await page.goto('/register');
  await expect(page.getByTestId('register-email')).toBeVisible();
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

test.describe('live backend portfolio dashboard', () => {
  const identity = createLiveIdentity();

  test('registers a fresh live account and renders dashboard/history data from the live backend', async ({
    page,
  }) => {
    await goToRegister(page);

    await page.getByTestId('register-email').fill(identity.email);
    await page.getByTestId('register-name').fill(identity.name);
    await page.getByTestId('register-password').fill(identity.password);
    await page.getByTestId('register-password-confirm').fill(identity.password);
    await page.getByTestId('register-submit').click();

    await expect(page).toHaveURL(/\/settings\/totp\/enroll(?:\?.*)?$/);
    await expect(page.getByTestId('totp-enroll-manual-key')).toBeVisible();

    const manualKey = (await page.getByTestId('totp-enroll-manual-key').textContent())?.trim();
    expect(manualKey).toBeTruthy();

    const code = generateTotp(manualKey!);
    await page.getByTestId('totp-enroll-code').fill(code);
    await page.getByTestId('totp-enroll-submit').click();

    await expect(page).toHaveURL(/\/portfolio$/);
    await expect(page.getByTestId('protected-area-title')).toHaveText('Portfolio overview');
    await expect(page.getByTestId('portfolio-demo-order')).toBeVisible();
    await expect(page.getByTestId('portfolio-masked-account')).toHaveText(MASKED_ACCOUNT_PATTERN);
    await expect(page.getByTestId('portfolio-symbol-error')).toHaveCount(0);
    await expect(page.getByTestId('portfolio-summary-error')).toHaveCount(0);
    await expect(page.getByTestId('portfolio-total-balance')).toBeVisible();
    await expect(page.getByTestId('portfolio-available-quantity')).toBeVisible();

    await page.getByTestId('portfolio-tab-history').click();

    await expect(page.getByTestId('portfolio-history-error')).toHaveCount(0);
    await expect(page.getByTestId('portfolio-history-page-indicator')).toHaveText(/^\d+ \/ \d+$/);
    await expect(page.getByTestId('order-list-empty')).toHaveText(
      '아직 주문 내역이 없습니다.',
    );
  });
});
