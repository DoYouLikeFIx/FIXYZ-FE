import { createHmac } from 'node:crypto';

import {
  expect,
  test,
  type Page,
} from '@playwright/test';

import { primeLiveBrowserCsrf, requireLiveAuthContractHealthy } from './_shared/liveAuthContract';

const DEFAULT_REGISTER_PASSWORD = 'LiveTest1!';
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

const createLiveIdentity = () => {
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;

  return {
    email: `mfa_recovery_live_${suffix}@example.com`,
    name: `MFA Recovery ${suffix}`,
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

    await delay(1_000);
    nextCode = generateTotp(manualEntryKey);
  }

  return nextCode;
};

const goToRegister = async (page: Page) => {
  await page.goto('/register');
  await expect(page.getByTestId('register-email')).toBeVisible();
  await primeLiveBrowserCsrf(page);
};

test.describe.serial('live backend MFA recovery rebind', () => {
  const identity = createLiveIdentity();

  test.beforeEach(async ({ request }) => {
    await requireLiveAuthContractHealthy(request);
  });

  test('rebinds authenticator on web, preserves redirect, and requires the new secret on the next login', async ({
    page,
  }) => {
    test.slow();

    await goToRegister(page);
    await page.getByTestId('register-email').fill(identity.email);
    await page.getByTestId('register-name').fill(identity.name);
    await page.getByTestId('register-password').fill(identity.password);
    await page.getByTestId('register-password-confirm').fill(identity.password);
    await page.getByTestId('register-submit').click();

    await expect(page).toHaveURL(/\/settings\/totp\/enroll(?:\?.*)?$/);
    await expect(page.getByTestId('totp-enroll-manual-key')).toBeVisible();

    const originalManualKey = (await page.getByTestId('totp-enroll-manual-key').textContent())?.trim();

    expect(originalManualKey).toBeTruthy();

    const originalTotpCode = generateTotp(originalManualKey!);
    await page.getByTestId('totp-enroll-code').fill(originalTotpCode);
    await page.getByTestId('totp-enroll-submit').click();

    await expect(page).toHaveURL(/\/portfolio$/);
    await expect(page.getByTestId('protected-area-title')).toHaveText('Portfolio overview');

    await page.goto('/mfa-recovery?redirect=/orders');
    await expect(page.getByTestId('mfa-recovery-current-password')).toBeVisible();
    await page.getByTestId('mfa-recovery-current-password').fill(identity.password);
    await page.getByTestId('mfa-recovery-submit').click();

    await expect(page).toHaveURL(/\/mfa-recovery\/rebind\?redirect=%2Forders$/);
    await expect(page.getByTestId('mfa-recovery-manual-key')).toBeVisible();

    const reboundManualKey = (await page.getByTestId('mfa-recovery-manual-key').textContent())?.trim();

    expect(reboundManualKey).toBeTruthy();

    const reboundConfirmCode = generateTotp(reboundManualKey!);
    await page.getByTestId('mfa-recovery-code').fill(reboundConfirmCode);
    await page.getByTestId('mfa-recovery-confirm-submit').click();

    await expect(page).toHaveURL(/\/login\?mfaRecovery=rebound&redirect=%2Forders$/);
    await expect(page.getByTestId('mfa-recovery-success')).toContainText(
      '새 authenticator 등록이 완료되었습니다. 새 비밀번호와 현재 인증 코드로 다시 로그인해 주세요.',
    );

    const [reboundLoginCode, oldSecretLoginCode] = await Promise.all([
      waitForNextTotp(reboundManualKey!, reboundConfirmCode),
      waitForNextTotp(originalManualKey!, originalTotpCode),
    ]);

    await page.getByTestId('login-email').fill(identity.email);
    await page.getByTestId('login-password').fill(identity.password);
    await page.getByTestId('login-submit').click();

    await expect(page.getByTestId('login-mfa-input')).toBeVisible();
    await page.getByTestId('login-mfa-input').fill(oldSecretLoginCode);
    await page.getByTestId('login-mfa-submit').click();

    await expect(page.getByTestId('login-mfa-error')).toHaveText(
      '인증 코드가 올바르지 않습니다. 앱에 표시된 현재 6자리 코드를 다시 입력해 주세요.',
    );

    await page.getByTestId('login-mfa-input').fill(reboundLoginCode);
    await page.getByTestId('login-mfa-submit').click();

    await expect(page).toHaveURL(/\/orders$/);
    await expect(page.getByTestId('protected-area-title')).toHaveText('Session-based order flow');
  });
});
