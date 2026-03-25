import { createHmac } from 'node:crypto';

import {
  type APIResponse,
  type Response,
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
const PROTECTED_ACCOUNT_BOUNDARY_STATUSES = [401, 403, 410];

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

const dashboardDateFormatter = new Intl.DateTimeFormat('ko-KR', {
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});
const quantityFormatter = new Intl.NumberFormat('ko-KR', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 4,
});

type QuoteSourceMode = 'LIVE' | 'DELAYED' | 'REPLAY' | (string & {});
type ValuationStatus = 'FRESH' | 'STALE' | 'UNAVAILABLE' | (string & {});
type ValuationUnavailableReason =
  | 'STALE_QUOTE'
  | 'QUOTE_MISSING'
  | 'PROVIDER_UNAVAILABLE'
  | (string & {});

interface AccountSummary {
  accountId: number;
  balance: number;
  availableBalance: number;
  currency: string;
  asOf: string;
}

interface AccountPosition {
  accountId: number;
  symbol: string;
  quantity: number;
  availableQuantity: number;
  availableQty: number;
  asOf: string;
  avgPrice?: number | null;
  marketPrice?: number | null;
  quoteSnapshotId?: string | null;
  quoteAsOf?: string | null;
  quoteSourceMode?: QuoteSourceMode | null;
  unrealizedPnl?: number | null;
  realizedPnlDaily?: number | null;
  valuationStatus?: ValuationStatus | null;
  valuationUnavailableReason?: ValuationUnavailableReason | null;
}

interface SessionMember {
  accountId?: string | null;
}

interface ApiEnvelope<T> {
  success?: boolean;
  data?: T;
  error?: {
    code?: string;
    message?: string;
  } | null;
}

const formatQuoteTimestamp = (value: string | null | undefined) => {
  if (!value) {
    return null;
  }

  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) {
    return null;
  }

  return dashboardDateFormatter.format(new Date(timestamp));
};

const formatSummaryTimestamp = (value: string | null | undefined) => {
  if (!value) {
    return '확인 불가';
  }

  return formatQuoteTimestamp(value) ?? '시각 확인 필요';
};

const formatTickerTimestamp = (value: string | null | undefined) =>
  formatQuoteTimestamp(value) ?? '시각 확인 필요';

const formatKRW = (amount: number) => new Intl.NumberFormat('ko-KR', {
  style: 'currency',
  currency: 'KRW',
  maximumFractionDigits: 0,
}).format(amount);

const formatSignedKRW = (amount: number) => {
  if (amount > 0) {
    return `+${formatKRW(amount)}`;
  }

  if (amount < 0) {
    return `-${formatKRW(Math.abs(amount))}`;
  }

  return formatKRW(0);
};

const formatQuantity = (amount: number) => quantityFormatter.format(amount);

const resolveValuationStatusLabel = (status: ValuationStatus | null | undefined) => {
  switch (status) {
    case 'FRESH':
      return '평가 가능';
    case 'STALE':
      return '시세 지연';
    case 'UNAVAILABLE':
      return '평가 불가';
    default:
      return '상태 확인 필요';
  }
};

const resolveValuationGuidance = (
  status: ValuationStatus | null | undefined,
  reason: ValuationUnavailableReason | null | undefined,
) => {
  switch (status) {
    case 'FRESH':
      return null;
    case 'STALE':
      return '호가 기준이 오래되어 평가 손익을 숨겼습니다.';
    case 'UNAVAILABLE':
      switch (reason) {
        case 'QUOTE_MISSING':
          return '시세 스냅샷이 없어 평가 손익을 숨겼습니다.';
        case 'PROVIDER_UNAVAILABLE':
          return '시세 제공자가 응답하지 않아 평가 손익을 숨겼습니다.';
        default:
          return '시세를 확인할 수 없어 평가 손익을 숨겼습니다.';
      }
    default:
      return status
        ? '백엔드 freshness 상태를 확인할 수 없어 평가 정보를 보수적으로 표시합니다.'
        : null;
  }
};

const formatAveragePriceValue = (position: AccountPosition) => {
  if (position.avgPrice === null || position.avgPrice === undefined) {
    return position.quantity === 0 ? '보유 없음' : '확인 불가';
  }

  return formatKRW(position.avgPrice);
};

const formatMarketDerivedValue = (
  value: number | null | undefined,
  valuationStatus: ValuationStatus | null | undefined,
  formatter: (amount: number) => string,
  ) => {
  if (valuationStatus !== 'FRESH' || value === null || value === undefined) {
    return '확인 불가';
  }

  return formatter(value);
};

const resolveQuoteSourceMode = (value: string | null | undefined) =>
  typeof value === 'string' && value.trim() ? value.trim() : '확인 불가';

const resolveAvailableQuantity = (position: AccountPosition) =>
  position.availableQuantity ?? position.availableQty;

const resolveTickerTone = (
  quoteSourceMode: QuoteSourceMode | null | undefined,
  valuationStatus: ValuationStatus | null | undefined,
  valuationUnavailableReason: ValuationUnavailableReason | null | undefined,
) => {
  if (valuationStatus === 'STALE') {
    return {
      stateLabel: '시세 지연',
      statusNote: '평가 손익 숨김',
    };
  }

  if (valuationStatus === 'UNAVAILABLE') {
    return {
      stateLabel: '평가 불가',
      statusNote: valuationUnavailableReason === 'QUOTE_MISSING'
        ? '시세 없음'
        : valuationUnavailableReason === 'PROVIDER_UNAVAILABLE'
          ? '시세 제공 실패'
          : '시세 확인 불가',
    };
  }

  switch (quoteSourceMode?.trim()) {
    case 'LIVE':
      return {
        stateLabel: '직결 시세',
        statusNote: '실시간 기준',
      };
    case 'DELAYED':
      return {
        stateLabel: '지연 호가',
        statusNote: '지연 도착 데이터',
      };
    case 'REPLAY':
      return {
        stateLabel: '리플레이 기준',
        statusNote: '재생 스냅샷',
      };
    default:
      return {
        stateLabel: '미확인 시세',
        statusNote: quoteSourceMode?.trim() ? '확인되지 않은 source mode' : 'source 정보 없음',
      };
  }
};

const formatFreshnessAge = (
  quoteAsOf: string | null | undefined,
  asOf: string | null | undefined,
) => {
  if (!quoteAsOf) {
    return '확인 불가';
  }

  const quoteTime = new Date(quoteAsOf).getTime();
  const asOfTime = new Date(asOf ?? '').getTime();

  if (!Number.isFinite(quoteTime) || !Number.isFinite(asOfTime)) {
    return '시각 확인 필요';
  }

  const deltaMs = Math.abs(asOfTime - quoteTime);

  if (deltaMs < 60_000) {
    return '동일 시각';
  }

  const deltaMinutes = Math.round(deltaMs / 60_000);

  if (deltaMinutes < 60) {
    return `${deltaMinutes}분 차이`;
  }

  const hours = Math.floor(deltaMinutes / 60);
  const minutes = deltaMinutes % 60;

  return minutes > 0
    ? `${hours}시간 ${minutes}분 차이`
    : `${hours}시간 차이`;
};

const getPathname = (url: string) => new URL(url).pathname;

const readJsonEnvelope = async <T>(
  response: APIResponse | Response,
  label: string,
) => {
  const payloadText = await response.text();

  if (!response.ok()) {
    throw new Error(
      `${label} returned ${response.status()} ${response.statusText()}`
      + (payloadText ? ` (${payloadText})` : ''),
    );
  }

  let payload: ApiEnvelope<T>;

  try {
    payload = JSON.parse(payloadText) as ApiEnvelope<T>;
  } catch {
    throw new Error(
      `${label} returned a non-JSON payload`
      + (payloadText ? ` (${payloadText})` : '.'),
    );
  }

  if (payload.success !== true) {
    throw new Error(
      `${label} returned success=false`
      + (payload.error?.message ? ` (${payload.error.message})` : ''),
    );
  }

  if (!Object.hasOwn(payload, 'data')) {
    throw new Error(`${label} did not include a data payload.`);
  }

  return payload.data as T;
};

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

const capturePortfolioBootstrap = async (page: Page) => {
  const summaryResponsePromise = page.waitForResponse(
    (response) => response.request().method() === 'GET'
      && /\/api\/v1\/accounts\/\d+\/summary$/.test(getPathname(response.url())),
  );
  const positionsResponsePromise = page.waitForResponse(
    (response) => response.request().method() === 'GET'
      && /\/api\/v1\/accounts\/\d+\/positions\/list$/.test(getPathname(response.url())),
  );

  await page.reload({ waitUntil: 'load' });
  await waitForPortfolioPath(page);

  const [summaryResponse, positionsResponse] = await Promise.all([
    summaryResponsePromise,
    positionsResponsePromise,
  ]);

  return {
    summary: await readJsonEnvelope<AccountSummary>(summaryResponse, 'Portfolio summary'),
    positions: await readJsonEnvelope<AccountPosition[]>(
      positionsResponse,
      'Portfolio positions list',
    ),
  };
};

const selectPortfolioSymbol = async (page: Page, symbol: string) => {
  const button = page.getByTestId(`portfolio-symbol-${symbol}`);

  await expect(button).toBeVisible();
  await button.click();
  await expect(button).toHaveClass(/account-history-toolbar__button--active/);
  await expect(page.getByText(new RegExp(`현재 조회 종목\\s*${symbol}`))).toBeVisible();
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

const fetchSessionAccountId = async (page: Page) => {
  const sessionPayload = await readJsonEnvelope<SessionMember>(
    await page.request.get('/api/v1/auth/session'),
    'Authenticated session',
  );
  const accountId = sessionPayload.accountId?.trim();

  if (!accountId) {
    throw new Error('Authenticated live session did not expose an accountId for portfolio verification.');
  }

  return accountId;
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
  await expect(page.getByTestId('portfolio-quote-source-mode')).toBeVisible();
  await expect(page.getByTestId('portfolio-dashboard-quote-ticker')).toBeVisible();
  await expect(page.getByTestId('portfolio-dashboard-quote-ticker-mode')).toBeVisible();
  await expect(page.getByTestId('portfolio-dashboard-quote-ticker-price')).toBeVisible();
  await expect(page.getByTestId('portfolio-dashboard-quote-ticker-quote-as-of')).toBeVisible();
  await expect(page.getByTestId('portfolio-dashboard-quote-ticker-chart')).toBeVisible();
  await expect(page.getByTestId('portfolio-dashboard-quote-ticker-status-note')).toBeVisible();
  await expect(page.getByTestId('portfolio-dashboard-quote-ticker-candle')).toHaveCount(0);
};

test.describe('live backend portfolio dashboard', () => {
  test.beforeEach(async ({ request }) => {
    await requireLiveAuthContractHealthy(request);
  });

  test('redirects anonymous portfolio access to login and blocks backend account dashboard endpoints', async ({
    page,
  }) => {
    await page.context().clearCookies();
    await page.goto('/portfolio?tab=positions');

    await expect(page).toHaveURL(/\/login\?redirect=%2Fportfolio%3Ftab%3Dpositions$/);
    await expect(page.getByTestId('login-email')).toBeVisible();

    const summaryResponse = await page.request.get('/api/v1/accounts/999999/summary');
    const positionsResponse = await page.request.get('/api/v1/accounts/999999/positions/list');

    expect(PROTECTED_ACCOUNT_BOUNDARY_STATUSES).toContain(summaryResponse.status());
    expect(PROTECTED_ACCOUNT_BOUNDARY_STATUSES).toContain(positionsResponse.status());
  });

  test('renders live portfolio dashboard and history states from the backend contract', async ({
    page,
  }) => {
    const reusedExistingAccount = await loginWithExistingLiveAccountToPortfolio(page);

    if (!reusedExistingAccount) {
      await registerEnrollAndLoginToPortfolio(page);
    }

    await expect(page.getByTestId('protected-area-title')).toHaveText('Portfolio overview');
    const accountId = await fetchSessionAccountId(page);
    const { summary, positions } = await capturePortfolioBootstrap(page);

    expect(summary.accountId).toBe(Number(accountId));
    await expect(page.getByTestId('portfolio-demo-order')).toBeVisible();
    await expect(page.getByTestId('portfolio-masked-account')).toHaveText(MASKED_ACCOUNT_PATTERN);
    await expect(page.getByTestId('portfolio-symbol-error')).toHaveCount(0);
    await expect(page.getByTestId('portfolio-summary-error')).toHaveCount(0);
    await expect(page.getByTestId('portfolio-total-balance')).toHaveText(
      formatKRW(summary.balance),
    );
    await expect(page.getByTestId('portfolio-summary-as-of')).toHaveText(
      formatSummaryTimestamp(summary.asOf),
    );

    if (positions.length === 0) {
      await expect(page.getByTestId('portfolio-symbol-empty')).toBeVisible();
      await expect(page.getByTestId('portfolio-dashboard-quote-ticker')).toHaveCount(0);
      await expect(page.getByTestId('portfolio-market-price')).toHaveCount(0);
    } else {
      const targetPosition = positions[0]!;

      await selectPortfolioSymbol(page, targetPosition.symbol);
      await expectDashboardQuoteChart(page);
      await expect(page.getByTestId('portfolio-available-quantity')).toHaveText(
        `${formatQuantity(resolveAvailableQuantity(targetPosition))}주`,
      );
    }

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
  });

  test('keeps FE portfolio valuation rows aligned with the live backend contract', async ({
    page,
  }) => {
    test.skip(
      !LIVE_LOGIN_EMAIL || !LIVE_LOGIN_PASSWORD,
      'LIVE_LOGIN_EMAIL and LIVE_LOGIN_PASSWORD are required for non-mutating live parity assertions.',
    );

    const reusedExistingAccount = await loginWithExistingLiveAccountToPortfolio(page);
    expect(reusedExistingAccount).toBe(true);

    await expect(page.getByTestId('protected-area-title')).toHaveText('Portfolio overview');
    const accountId = await fetchSessionAccountId(page);
    const { summary, positions } = await capturePortfolioBootstrap(page);

    expect(summary.accountId).toBe(Number(accountId));

    if (positions.length === 0) {
      test.skip(true, 'LIVE login account must already own at least one position for portfolio parity assertions.');
    }

    const selectedPosition = positions[0]!;
    await selectPortfolioSymbol(page, selectedPosition.symbol);

    await expect(page.getByTestId('portfolio-total-balance')).toHaveText(
      formatKRW(summary.balance),
    );
    await expect(page.getByTestId('portfolio-summary-as-of')).toHaveText(
      formatSummaryTimestamp(summary.asOf),
    );
    await expect(page.getByTestId('portfolio-available-quantity')).toHaveText(
      `${formatQuantity(resolveAvailableQuantity(selectedPosition))}주`,
    );

    const valuationStatus = selectedPosition.valuationStatus ?? null;
    const valuationGuidance = resolveValuationGuidance(
      valuationStatus,
      selectedPosition.valuationUnavailableReason ?? null,
    );
    const tickerTone = resolveTickerTone(
      selectedPosition.quoteSourceMode ?? null,
      valuationStatus,
      selectedPosition.valuationUnavailableReason ?? null,
    );

    await expect(page.getByTestId('portfolio-avg-price')).toHaveText(
      formatAveragePriceValue(selectedPosition),
    );
    await expect(page.getByTestId('portfolio-valuation-status')).toHaveText(
      resolveValuationStatusLabel(valuationStatus),
    );
    await expect(page.getByTestId('portfolio-market-price')).toHaveText(
      formatMarketDerivedValue(selectedPosition.marketPrice, valuationStatus, formatKRW),
    );
    await expect(page.getByTestId('portfolio-unrealized-pnl')).toHaveText(
      formatMarketDerivedValue(selectedPosition.unrealizedPnl, valuationStatus, formatSignedKRW),
    );
    await expect(page.getByTestId('portfolio-realized-pnl-daily')).toHaveText(
      formatMarketDerivedValue(
        selectedPosition.realizedPnlDaily,
        valuationStatus,
        formatSignedKRW,
      ),
    );
    await expect(page.getByTestId('portfolio-quote-as-of')).toHaveText(
      formatSummaryTimestamp(selectedPosition.quoteAsOf),
    );
    await expect(page.getByTestId('portfolio-quote-source-mode')).toHaveText(
      resolveQuoteSourceMode(selectedPosition.quoteSourceMode),
    );
    await expect(page.getByTestId('portfolio-dashboard-quote-ticker-symbol')).toHaveText(
      selectedPosition.symbol,
    );
    await expect(page.getByTestId('portfolio-dashboard-quote-ticker-mode')).toHaveText(
      resolveQuoteSourceMode(selectedPosition.quoteSourceMode),
    );
    await expect(page.getByTestId('portfolio-dashboard-quote-ticker-state')).toHaveText(
      tickerTone.stateLabel,
    );
    await expect(page.getByTestId('portfolio-dashboard-quote-ticker-status-note')).toHaveText(
      tickerTone.statusNote,
    );
    await expect(page.getByTestId('portfolio-dashboard-quote-ticker-price')).toHaveText(
      formatMarketDerivedValue(selectedPosition.marketPrice, valuationStatus, formatKRW),
    );
    await expect(page.getByTestId('portfolio-dashboard-quote-ticker-guidance')).toHaveText(
      valuationGuidance ?? tickerTone.statusNote,
    );
    await expect(page.getByTestId('portfolio-dashboard-quote-ticker-quote-as-of')).toHaveText(
      formatTickerTimestamp(selectedPosition.quoteAsOf),
    );
    await expect(page.getByTestId('portfolio-dashboard-quote-ticker-snapshot')).toHaveText(
      selectedPosition.quoteSnapshotId ?? '확인 불가',
    );
    await expect(page.getByTestId('portfolio-dashboard-quote-ticker-freshness-age')).toHaveText(
      formatFreshnessAge(selectedPosition.quoteAsOf, selectedPosition.asOf),
    );

    if (valuationGuidance) {
      await expect(page.getByTestId('portfolio-valuation-guidance')).toContainText(
        resolveValuationStatusLabel(valuationStatus),
      );
      await expect(page.getByTestId('portfolio-valuation-guidance')).toContainText(
        valuationGuidance,
      );
      await expect(page.getByTestId('portfolio-valuation-guidance')).toContainText(
        formatSummaryTimestamp(selectedPosition.quoteAsOf),
      );
      await expect(page.getByTestId('portfolio-valuation-guidance')).toContainText(
        resolveQuoteSourceMode(selectedPosition.quoteSourceMode),
      );
    } else {
      await expect(page.getByTestId('portfolio-valuation-guidance')).toHaveCount(0);
    }
  });
});
