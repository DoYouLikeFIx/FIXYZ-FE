import { createHmac } from 'node:crypto';

import {
  expect,
  test,
  type Page,
} from '@playwright/test';

import { requireLiveAuthContractHealthy } from './_shared/liveAuthContract';

const DEFAULT_REGISTER_PASSWORD = 'LiveTest1!';
const MASKED_ACCOUNT_PATTERN = /(^\*\*\*-[*\d]{4}$)|(^\d{3}-\*{4}-\d{4}$)/;
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const LIVE_LOGIN_EMAIL = process.env.LIVE_LOGIN_EMAIL?.trim();
const LIVE_LOGIN_PASSWORD = process.env.LIVE_LOGIN_PASSWORD?.trim();
const LIVE_LOGIN_OTP = process.env.LIVE_LOGIN_OTP?.trim();
const LIVE_LOGIN_TOTP_SECRET = process.env.LIVE_LOGIN_TOTP_SECRET?.trim();

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

const goToLogin = async (page: Page) => {
  await page.goto('/login?redirect=/portfolio');
  await expect(page.getByTestId('login-email')).toBeVisible();
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

const generateStableTotp = async (
  manualEntryKey: string,
  minRemainingMs = 8_000,
) => {
  if (millisUntilNextTotpWindow() < minRemainingMs) {
    await delay(millisUntilNextTotpWindow() + 1_500);
  }

  return generateTotp(manualEntryKey);
};

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

const waitForPortfolioPath = async (page: Page) => {
  await expect.poll(() => {
    const url = new URL(page.url());
    return url.pathname;
  }, {
    timeout: 20_000,
    message: 'Expected browser to navigate to /portfolio pathname.',
  }).toBe('/portfolio');
};

const waitForLoginStep = async (page: Page): Promise<'portfolio' | 'mfa' | 'error'> => {
  const mfaInput = page.getByTestId('login-mfa-input');
  const loginError = page.getByTestId('error-message');
  const startedAt = Date.now();

  while (Date.now() - startedAt <= 15_000) {
    const pathname = new URL(page.url()).pathname;

    if (pathname === '/portfolio') {
      return 'portfolio';
    }

    if (await mfaInput.isVisible().catch(() => false)) {
      return 'mfa';
    }

    if (await loginError.isVisible().catch(() => false)) {
      return 'error';
    }

    await delay(250);
  }

  throw new Error('Expected login to reach /portfolio, show MFA challenge, or show a login error message within 15s.');
};

const waitForNonEmptyText = async (
  page: Page,
  testId: string,
  timeout = 15_000,
) => {
  await expect.poll(
    async () => ((await page.getByTestId(testId).textContent())?.trim() ?? ''),
    { timeout },
  ).not.toBe('');

  return ((await page.getByTestId(testId).textContent())?.trim() ?? '');
};

const loginWithExistingLiveAccountToPortfolio = async (page: Page) => {
  if (!LIVE_LOGIN_EMAIL || !LIVE_LOGIN_PASSWORD) {
    return false;
  }

  await goToLogin(page);
  await page.getByTestId('login-email').fill(LIVE_LOGIN_EMAIL);
  await page.getByTestId('login-password').fill(LIVE_LOGIN_PASSWORD);
  await page.getByTestId('login-submit').click();

  const loginStep = await waitForLoginStep(page);

  if (loginStep === 'error') {
    const message = (await page.getByTestId('error-message').textContent())?.trim() ?? 'Unknown login error';
    throw new Error(`Live account password login failed before MFA: ${message}`);
  }

  if (loginStep === 'mfa') {
    if (!LIVE_LOGIN_OTP && !LIVE_LOGIN_TOTP_SECRET) {
      throw new Error('LIVE_LOGIN_OTP or LIVE_LOGIN_TOTP_SECRET is required when live account login prompts MFA verification.');
    }

    const mfaInput = page.getByTestId('login-mfa-input');
    const maxAttempts = LIVE_LOGIN_TOTP_SECRET ? 3 : 1;
    let previousCode = '';
    let mfaPassed = false;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const mfaCode = LIVE_LOGIN_TOTP_SECRET
        ? (attempt === 1
          ? await generateStableTotp(LIVE_LOGIN_TOTP_SECRET)
          : await waitForNextTotp(LIVE_LOGIN_TOTP_SECRET, previousCode))
        : LIVE_LOGIN_OTP!;

      previousCode = mfaCode;
      await mfaInput.fill(mfaCode);
      await page.getByTestId('login-mfa-submit').click();

      const reachedPortfolio = await expect.poll(() => {
        const url = new URL(page.url());
        return url.pathname === '/portfolio';
      }, {
        timeout: 8_000,
        message: `Expected browser to navigate to /portfolio after MFA attempt ${attempt}.`,
      }).toBeTruthy().then(() => true).catch(() => false);

      if (reachedPortfolio) {
        mfaPassed = true;
        break;
      }
    }

    if (!mfaPassed) {
      const message = await page.getByTestId('login-mfa-error').textContent().catch(() => null);
      throw new Error(`Live account MFA verification did not complete. ${message?.trim() ? `Server message: ${message.trim()}` : 'Check LIVE_LOGIN_TOTP_SECRET/LIVE_LOGIN_OTP validity and server clock skew.'}`);
    }
  }

  await waitForPortfolioPath(page);
  return true;
};

const registerEnrollAndLoginToPortfolio = async (page: Page) => {
  const identity = createLiveIdentity();

  await goToRegister(page);
  await page.getByTestId('register-email').fill(identity.email);
  await page.getByTestId('register-name').fill(identity.name);
  await page.getByTestId('register-password').fill(identity.password);
  await page.getByTestId('register-password-confirm').fill(identity.password);
  await page.getByTestId('register-submit').click();

  await expect(page).toHaveURL(/\/settings\/totp\/enroll(?:\?.*)?$/);
  await expect(page.getByTestId('totp-enroll-manual-key')).toBeVisible();

  const manualKey = await waitForNonEmptyText(page, 'totp-enroll-manual-key');
  const code = await generateStableTotp(manualKey);
  await page.getByTestId('totp-enroll-code').fill(code);
  await page.getByTestId('totp-enroll-submit').click();

  await waitForPortfolioPath(page);

  await clearBrowserSession(page);
  await goToLogin(page);
  await page.getByTestId('login-email').fill(identity.email);
  await page.getByTestId('login-password').fill(identity.password);
  await page.getByTestId('login-submit').click();

  await expect(page.getByTestId('login-mfa-input')).toBeVisible();
  const loginCode = await waitForNextTotp(manualKey, code);
  await page.getByTestId('login-mfa-input').fill(loginCode);
  await page.getByTestId('login-mfa-submit').click();

  await waitForPortfolioPath(page);
};

const expectDashboardQuoteChart = async (page: Page) => {
  await expect(page.getByTestId('portfolio-market-price')).toBeVisible();
  await expect(page.getByTestId('portfolio-quote-as-of')).toBeVisible();
  await expect(page.getByTestId('portfolio-quote-source-mode')).toHaveText(/^(LIVE|DELAYED|REPLAY)$/);
  await expect(page.getByTestId('portfolio-dashboard-quote-ticker')).toBeVisible();
  await expect(page.getByTestId('portfolio-dashboard-quote-ticker-mode')).toHaveText(/^(LIVE|DELAYED|REPLAY)$/);
  await expect(page.getByTestId('portfolio-dashboard-quote-ticker-price')).toBeVisible();
  await expect(page.getByTestId('portfolio-dashboard-quote-ticker-quote-as-of')).toBeVisible();
  await expect(page.getByTestId('portfolio-dashboard-quote-ticker-chart')).toBeVisible();
  await expect(page.getByTestId('portfolio-dashboard-quote-ticker-status-note')).toBeVisible();
  await expect(page.getByTestId('portfolio-dashboard-quote-ticker-candle')).toHaveCount(0);
};

const provisionPositionViaOrderFlow = async (page: Page) => {
  await page.goto('/orders');
  await expect(page.getByTestId('protected-area-title')).toHaveText('Session-based order flow');
  await expect(page.getByTestId('order-session-create')).toBeVisible();

  const createOrderSessionResponsePromise = page.waitForResponse(
    (response) =>
      response.url().includes('/api/v1/orders/sessions')
      && !response.url().includes('/execute')
      && response.request().method() === 'POST',
  );
  await page.getByTestId('order-session-create').click();
  const createOrderSessionResponse = await createOrderSessionResponsePromise;
  expect(createOrderSessionResponse.ok()).toBe(true);

  await expect(page.getByTestId('order-session-execute')).toBeVisible();

  const executeOrderSessionResponsePromise = page.waitForResponse(
    (response) =>
      response.url().includes('/api/v1/orders/sessions/')
      && response.url().includes('/execute')
      && response.request().method() === 'POST',
  );
  await page.getByTestId('order-session-execute').click();
  const executeOrderSessionResponse = await executeOrderSessionResponsePromise;
  expect(executeOrderSessionResponse.ok()).toBe(true);

  await expect(page.getByTestId('order-session-summary')).toContainText('상태 COMPLETED');
  await page.goto('/portfolio');
  await expect(page.getByTestId('protected-area-title')).toHaveText('Portfolio overview');
};

test.describe('live backend portfolio dashboard', () => {
  test.beforeEach(async ({ request }) => {
    await requireLiveAuthContractHealthy(request);
  });

  test('renders dashboard quote chart and history data from the live backend', async ({
    page,
  }) => {
    let provisionedPosition = false;
    const reusedExistingAccount = await loginWithExistingLiveAccountToPortfolio(page);

    if (!reusedExistingAccount) {
      await registerEnrollAndLoginToPortfolio(page);
    }

    await expect(page.getByTestId('protected-area-title')).toHaveText('Portfolio overview');
    await expect(page.getByTestId('portfolio-demo-order')).toBeVisible();
    await expect(page.getByTestId('portfolio-masked-account')).toHaveText(MASKED_ACCOUNT_PATTERN);
    await expect(page.getByTestId('portfolio-symbol-error')).toHaveCount(0);
    await expect(page.getByTestId('portfolio-summary-error')).toHaveCount(0);
    await expect(page.getByTestId('portfolio-total-balance')).toBeVisible();
    await expect(page.getByTestId('portfolio-available-quantity')).toBeVisible();

    if (await page.getByTestId('portfolio-market-price').count() === 0) {
      await provisionPositionViaOrderFlow(page);
      provisionedPosition = true;
    }

    await expectDashboardQuoteChart(page);

    await page.getByTestId('portfolio-tab-history').click();

    await expect(page.getByTestId('portfolio-history-error')).toHaveCount(0);
    await expect(page.getByTestId('portfolio-history-page-indicator')).toHaveText(/^\d+ \/ \d+$/);

    if (provisionedPosition) {
      await expect(page.getByTestId('order-list')).toBeVisible();
      await expect(page.getByTestId('order-list-empty')).toHaveCount(0);
      await expect.poll(
        async () => page.locator('[data-testid^="order-row-"]').count(),
        { timeout: 15_000 },
      ).toBeGreaterThan(0);
      return;
    }

    await expect.poll(
      async () => (
        await page.getByTestId('order-list').count()
      ) + (
        await page.getByTestId('order-list-empty').count()
      ),
      { timeout: 15_000 },
    ).toBeGreaterThan(0);
  });
});
