import { spawnSync } from 'node:child_process';
import { createHmac } from 'node:crypto';

import {
  expect,
  test,
  type Page,
} from '@playwright/test';

import { primeLiveBrowserCsrf, requireLiveAuthContractHealthy } from './_shared/liveAuthContract';

const DEFAULT_REGISTER_PASSWORD = 'LiveTest1!';
const MASKED_ACCOUNT_PATTERN = /(^\*\*\*-[*\d]{4}$)|(^\d{3}-\*{4}-\d{4}$)/;
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const LIVE_LOGIN_EMAIL = process.env.LIVE_LOGIN_EMAIL?.trim();
const LIVE_LOGIN_PASSWORD = process.env.LIVE_LOGIN_PASSWORD?.trim();
const LIVE_LOGIN_OTP = process.env.LIVE_LOGIN_OTP?.trim();
const LIVE_LOGIN_TOTP_SECRET = process.env.LIVE_LOGIN_TOTP_SECRET?.trim();
const LIVE_CORE_DB_CONTAINER = process.env.LIVE_CORE_DB_CONTAINER?.trim() || 'mysql';
const LIVE_CORE_DB_USER = process.env.LIVE_CORE_DB_USER?.trim() || 'fix';
const LIVE_CORE_DB_PASSWORD = process.env.LIVE_CORE_DB_PASSWORD?.trim() || 'fix';
const LIVE_CORE_DB_NAME = process.env.LIVE_CORE_DB_NAME?.trim() || 'core_db';

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
  await primeLiveBrowserCsrf(page);
};

const goToLogin = async (page: Page) => {
  await page.goto('/login?redirect=/portfolio');
  await expect(page.getByTestId('login-email')).toBeVisible();
  await primeLiveBrowserCsrf(page);
};

const escapeSqlString = (value: string) => value.replaceAll("'", "''");

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

const waitForPortfolioQuoteData = async (
  page: Page,
  timeout = 30_000,
) => {
  const startedAt = Date.now();
  let lastState = 'portfolio quote data never appeared';

  while (Date.now() - startedAt <= timeout) {
    if (await page.getByTestId('portfolio-market-price').isVisible().catch(() => false)) {
      return;
    }

    const emptyStateVisible = await page.getByText('아직 보유 중인 종목이 없습니다.').isVisible().catch(() => false);
    lastState = emptyStateVisible ? 'portfolio still reported no owned positions' : 'portfolio quote card still loading';

    await delay(1_000);

    if (emptyStateVisible) {
      await page.reload({ waitUntil: 'load' });
      await waitForPortfolioPath(page);
    }
  }

  throw new Error(`Timed out waiting for portfolio quote data after order completion (${lastState}).`);
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

const provisionPortfolioHolding = (email: string) => {
  const escapedEmail = escapeSqlString(email);
  const sql = [
    `SET @member_id := (SELECT id FROM channel_db.members WHERE email='${escapedEmail}' LIMIT 1);`,
    'SET @account_id := (SELECT id FROM core_db.accounts WHERE member_id=@member_id LIMIT 1);',
    'INSERT INTO core_db.positions (account_id, symbol, qty, avg_price, created_at, updated_at, version)',
    " VALUES (@account_id, '005930', 3.0000, 70100.0000, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 0)",
    " ON DUPLICATE KEY UPDATE qty=VALUES(qty), avg_price=VALUES(avg_price), updated_at=CURRENT_TIMESTAMP;",
    "SELECT qty FROM core_db.positions WHERE account_id=@account_id AND symbol='005930';",
  ].join(' ');

  const result = spawnSync(
    'docker',
    [
      'exec',
      LIVE_CORE_DB_CONTAINER,
      'mysql',
      `-u${LIVE_CORE_DB_USER}`,
      `-p${LIVE_CORE_DB_PASSWORD}`,
      '-N',
      '-B',
      '-D',
      LIVE_CORE_DB_NAME,
      '-e',
      sql,
    ],
    {
      encoding: 'utf8',
    },
  );

  if (result.status !== 0) {
    throw new Error(
      `Failed to seed a live portfolio holding via local DB fixture: ${result.stderr || result.stdout || 'unknown error'}`,
    );
  }

  const seededQuantity = result.stdout
    .trim()
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .at(-1);

  if (seededQuantity !== '3.0000') {
    throw new Error(`Live portfolio holding fixture did not confirm qty=3.0000 (received ${seededQuantity ?? 'empty output'}).`);
  }
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
  return identity;
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

const provisionPortfolioHoldingFixture = async (page: Page, portfolioEmail: string) => {
  provisionPortfolioHolding(portfolioEmail);
  await page.goto('/portfolio');
  await expect(page.getByTestId('protected-area-title')).toHaveText('Portfolio overview');
  await waitForPortfolioQuoteData(page);
};

test.describe('live backend portfolio dashboard', () => {
  test.beforeEach(async ({ request }) => {
    await requireLiveAuthContractHealthy(request);
  });

  test('renders dashboard quote chart and history state from the live backend', async ({
    page,
  }) => {
    let provisionedPosition = false;
    let portfolioEmail = LIVE_LOGIN_EMAIL ?? null;
    const reusedExistingAccount = await loginWithExistingLiveAccountToPortfolio(page);

    if (!reusedExistingAccount) {
      const identity = await registerEnrollAndLoginToPortfolio(page);
      portfolioEmail = identity.email;
    }

    await expect(page.getByTestId('protected-area-title')).toHaveText('Portfolio overview');
    await expect(page.getByTestId('portfolio-demo-order')).toBeVisible();
    await expect(page.getByTestId('portfolio-masked-account')).toHaveText(MASKED_ACCOUNT_PATTERN);
    await expect(page.getByTestId('portfolio-symbol-error')).toHaveCount(0);
    await expect(page.getByTestId('portfolio-summary-error')).toHaveCount(0);
    await expect(page.getByTestId('portfolio-total-balance')).toBeVisible();
    await expect(page.getByTestId('portfolio-available-quantity')).toBeVisible();

    if (await page.getByTestId('portfolio-market-price').count() === 0) {
      if (!portfolioEmail) {
        throw new Error('Portfolio live fixture requires a known account email to seed a holding.');
      }

      await provisionPortfolioHoldingFixture(page, portfolioEmail);
      provisionedPosition = true;
    }

    await expectDashboardQuoteChart(page);

    await page.getByTestId('portfolio-tab-history').click();

    await expect(page.getByTestId('portfolio-history-error')).toHaveCount(0);
    await expect(page.getByTestId('portfolio-history-page-indicator')).toHaveText(/^\d+ \/ \d+$/);

    await expect.poll(
      async () => (
        await page.getByTestId('order-list').count()
      ) + (
        await page.getByTestId('order-list-empty').count()
      ),
      { timeout: 15_000 },
    ).toBeGreaterThan(0);

    if (provisionedPosition) {
      await expect(page.getByTestId('order-list-empty')).toBeVisible();
    }
  });
});
