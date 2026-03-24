import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  expect,
  test,
  type APIResponse,
  type Page,
} from '@playwright/test';

import { primeLiveBrowserCsrf } from './_shared/liveAuthContract';

const DEFAULT_REGISTER_PASSWORD = 'LiveOrder1!';
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const LIVE_DIRECT_BASE_URL = process.env.LIVE_API_BASE_URL?.trim() || 'http://127.0.0.1:8080';
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
const QUOTE_SOURCE_MODE_PATTERN = /^(LIVE|DELAYED|REPLAY)$/;

const expectLiveQuoteMetadata = (payload: {
  data?: {
    quoteSnapshotId?: string | null;
    quoteAsOf?: string | null;
    quoteSourceMode?: string | null;
  };
}) => {
  expect(payload.data?.quoteSnapshotId).toBeTruthy();
  expect(payload.data?.quoteAsOf).toBeTruthy();
  expect(payload.data?.quoteSourceMode).toMatch(QUOTE_SOURCE_MODE_PATTERN);
};

const createLiveIdentity = () => {
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;

  return {
    email: `order_live_${suffix}@example.com`,
    name: `Order Live ${suffix}`,
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

class LiveCookieJar {
  private readonly cookies = new Map<string, {
    value: string;
    path: string;
    httpOnly: boolean;
    secure: boolean;
    sameSite: 'Lax' | 'None' | 'Strict';
  }>();

  rememberFromHeaders(headers: Headers) {
    const candidate = headers as Headers & {
      getSetCookie?: () => string[];
    };
    const setCookieHeaders = typeof candidate.getSetCookie === 'function'
      ? candidate.getSetCookie()
      : headers.get('set-cookie')
        ? [headers.get('set-cookie')!]
        : [];

    for (const header of setCookieHeaders) {
      const [pair, ...attributes] = header.split(';');
      const separatorIndex = pair.indexOf('=');

      if (separatorIndex <= 0) {
        continue;
      }

      const name = pair.slice(0, separatorIndex).trim();
      const value = pair.slice(separatorIndex + 1).trim();
      const metadata: {
        value: string;
        path: string;
        httpOnly: boolean;
        secure: boolean;
        sameSite: 'Lax' | 'None' | 'Strict';
      } = {
        value,
        path: '/',
        httpOnly: false,
        secure: false,
        sameSite: 'Lax',
      };

      for (const attribute of attributes) {
        const normalized = attribute.trim();
        const [attributeName, attributeValue] = normalized.split('=', 2);

        if (attributeName.toLowerCase() === 'path' && attributeValue) {
          metadata.path = attributeValue;
        }
        if (attributeName.toLowerCase() === 'httponly') {
          metadata.httpOnly = true;
        }
        if (attributeName.toLowerCase() === 'secure') {
          metadata.secure = true;
        }
        if (attributeName.toLowerCase() === 'samesite' && attributeValue) {
          if (attributeValue === 'Strict' || attributeValue === 'Lax' || attributeValue === 'None') {
            metadata.sameSite = attributeValue;
          }
        }
      }

      this.cookies.set(name, metadata);
    }
  }

  setCookie(
    name: string,
    value: string,
    overrides: Partial<{
      path: string;
      httpOnly: boolean;
      secure: boolean;
      sameSite: 'Lax' | 'None' | 'Strict';
    }> = {},
  ) {
    this.cookies.set(name, {
      value,
      path: overrides.path ?? '/',
      httpOnly: overrides.httpOnly ?? false,
      secure: overrides.secure ?? false,
      sameSite: overrides.sameSite ?? 'Lax',
    });
  }

  toCookieHeader() {
    return [...this.cookies.entries()]
      .map(([name, metadata]) => `${name}=${metadata.value}`)
      .join('; ');
  }

  toPlaywrightCookies() {
    const hostname = new URL(LIVE_DIRECT_BASE_URL).hostname;

    return [...this.cookies.entries()].map(([name, metadata]) => ({
      name,
      value: metadata.value,
      domain: hostname,
      path: metadata.path,
      httpOnly: metadata.httpOnly,
      secure: metadata.secure,
      sameSite: metadata.sameSite,
      expires: -1,
    }));
  }
}

const fetchLiveJson = async <T>(
  cookieJar: LiveCookieJar,
  path: string,
  init: RequestInit,
  timeoutMs: number,
) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const headers = new Headers(init.headers);
  const cookieHeader = cookieJar.toCookieHeader();

  if (cookieHeader) {
    headers.set('Cookie', cookieHeader);
  }

  try {
    const response = await fetch(`${LIVE_DIRECT_BASE_URL}${path}`, {
      ...init,
      headers,
      signal: controller.signal,
    });

    cookieJar.rememberFromHeaders(response.headers);

    if (!response.ok) {
      throw new Error(`${path} returned ${response.status}`);
    }

    return await response.json() as T;
  } finally {
    clearTimeout(timer);
  }
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

const firstHeaderValue = (value: string | undefined) =>
  value
    ?.split(',')
    .map((entry) => entry.trim())
    .find((entry) => entry.length > 0);

const expectCorrelationHeaders = (headers: Record<string, string>) => {
  expect(firstHeaderValue(headers['x-correlation-id'])).toBeTruthy();
  expect(firstHeaderValue(headers.traceparent)).toMatch(
    /^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/i,
  );
};

const expectLiveAuthBootstrapReady = async (response: APIResponse) => {
  expect(response.ok()).toBe(true);

  const payload = await response.json() as {
    data?: {
      csrfToken?: string;
      token?: string;
    };
  };

  expect(payload.data?.csrfToken ?? payload.data?.token).toBeTruthy();
};

const waitForNonEmptyText = async (
  page: Page,
  testId: string,
  timeout = 30_000,
) => {
  await expect.poll(
    async () => ((await page.getByTestId(testId).textContent())?.trim() ?? ''),
    { timeout },
  ).not.toBe('');

  return ((await page.getByTestId(testId).textContent())?.trim() ?? '');
};

const fetchLiveCsrf = async (cookieJar: LiveCookieJar) => {
  const payload = await fetchLiveJson<{
    data?: {
      csrfToken?: string;
      token?: string;
      headerName?: string;
    };
  }>(
    cookieJar,
    '/api/v1/auth/csrf',
    {
      method: 'GET',
    },
    60_000,
  );

  const csrfToken = payload.data?.csrfToken ?? payload.data?.token;

  expect(csrfToken).toBeTruthy();
  cookieJar.setCookie('XSRF-TOKEN', csrfToken!, {
    sameSite: 'Strict',
  });

  return {
    csrfToken: csrfToken!,
    headerName: payload.data?.headerName ?? 'X-CSRF-TOKEN',
  };
};

const bootstrapFreshLiveOrderSession = async (
  page: Page,
) => {
  const identity = createLiveIdentity();
  const cookieJar = new LiveCookieJar();
  let csrf = await fetchLiveCsrf(cookieJar);

  await fetchLiveJson(
    cookieJar,
    '/api/v1/auth/register',
    {
      method: 'POST',
      headers: {
        [csrf.headerName]: csrf.csrfToken,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        email: identity.email,
        password: identity.password,
        name: identity.name,
      }).toString(),
    },
    60_000,
  );

  csrf = await fetchLiveCsrf(cookieJar);

  const loginPayload = await fetchLiveJson<{
    data?: {
      loginToken?: string;
      nextAction?: string;
    };
  }>(
    cookieJar,
    '/api/v1/auth/login',
    {
      method: 'POST',
      headers: {
        [csrf.headerName]: csrf.csrfToken,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        email: identity.email,
        password: identity.password,
      }).toString(),
    },
    60_000,
  );
  const loginToken = loginPayload.data?.loginToken;

  expect(loginPayload.data?.nextAction).toBe('ENROLL_TOTP');
  expect(loginToken).toBeTruthy();

  const enrollPayload = await fetchLiveJson<{
    data?: {
      manualEntryKey?: string;
      enrollmentToken?: string;
    };
  }>(
    cookieJar,
    '/api/v1/members/me/totp/enroll',
    {
      method: 'POST',
      headers: {
        [csrf.headerName]: csrf.csrfToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        loginToken,
      }),
    },
    60_000,
  );
  const manualEntryKey = enrollPayload.data?.manualEntryKey ?? '';
  const enrollmentToken = enrollPayload.data?.enrollmentToken ?? '';

  expect(manualEntryKey).toBeTruthy();
  expect(enrollmentToken).toBeTruthy();

  const enrollmentCode = await generateStableTotp(manualEntryKey);
  csrf = await fetchLiveCsrf(cookieJar);
  await fetchLiveJson(
    cookieJar,
    '/api/v1/members/me/totp/confirm',
    {
      method: 'POST',
      headers: {
        [csrf.headerName]: csrf.csrfToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        loginToken,
        enrollmentToken,
        otpCode: enrollmentCode,
      }),
    },
    60_000,
  );

  await page.context().clearCookies();
  await page.context().addCookies(cookieJar.toPlaywrightCookies());
  await page.goto('/orders');
  await expect(page).toHaveURL(/\/orders$/);
  await expect(page.getByTestId('protected-area-title')).toHaveText('Session-based order flow');
  await expect(page.getByTestId('order-session-selected-summary')).toContainText('005930');

  return {
    manualEntryKey,
    lastUsedTotp: enrollmentCode,
  };
};

const registerEnrollAndLoginToOrders = async (page: Page) => {
  const identity = createLiveIdentity();

  await goToRegister(page);
  await page.getByTestId('register-email').fill(identity.email);
  await page.getByTestId('register-name').fill(identity.name);
  await page.getByTestId('register-password').fill(identity.password);
  await page.getByTestId('register-password-confirm').fill(identity.password);
  await page.getByTestId('register-submit').click();
  await expect(page).toHaveURL(/\/settings\/totp\/enroll(?:\?.*)?$/);
  await expect(page.getByTestId('totp-enroll-manual-key')).toBeVisible({
    timeout: 35_000,
  });

  const manualEntryKey = await waitForNonEmptyText(page, 'totp-enroll-manual-key');
  expect(manualEntryKey).toBeTruthy();

  const enrollmentCode = await generateStableTotp(manualEntryKey!);
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
  test.beforeEach(async ({ request }) => {
    const csrfResponse = await request.get('/api/v1/auth/csrf', {
      timeout: 30_000,
    });

    await expectLiveAuthBootstrapReady(csrfResponse);
  });

  test('creates and executes a low-risk order session after a fresh MFA login', async ({ page }) => {
    test.slow();
    test.setTimeout(150_000);

    await registerEnrollAndLoginToOrders(page);

    const createOrderSessionResponsePromise = page.waitForResponse(
      (response) =>
        response.url().includes('/api/v1/orders/sessions')
        && !response.url().includes('/execute')
        && response.request().method() === 'POST',
    );
    await page.getByTestId('order-session-create').click();
    const createOrderSessionResponse = await createOrderSessionResponsePromise;
    expect(createOrderSessionResponse.ok()).toBe(true);
    expectCorrelationHeaders(await createOrderSessionResponse.allHeaders());
    const createdSessionPayload = await createOrderSessionResponse.json() as {
      data?: {
        accountId?: number;
      };
    };
    expect(createdSessionPayload.data?.accountId).toBeTruthy();

    await expect(page.getByTestId('order-session-execute')).toBeVisible();
    await expect(page.getByTestId('order-session-summary')).toContainText('상태 AUTHED');
    await expect(page.getByTestId('order-session-authorization-message')).toContainText(
      authorizationScenario('auto-authorized-confirm').body,
    );

    const executeOrderSessionResponsePromise = page.waitForResponse(
      (response) =>
        response.url().includes('/api/v1/orders/sessions/')
        && response.url().includes('/execute')
        && response.request().method() === 'POST',
    );
    await page.getByTestId('order-session-execute').click();
    const executeOrderSessionResponse = await executeOrderSessionResponsePromise;
    expect(executeOrderSessionResponse.ok()).toBe(true);
    expectCorrelationHeaders(await executeOrderSessionResponse.allHeaders());

    await expect(page.getByTestId('order-session-summary')).toContainText('상태 COMPLETED');
    await expect(page.getByTestId('order-session-result')).toBeVisible();
    await expectCanonicalFinalResultCard(page);
    await expect(page.getByTestId('external-order-feedback')).toHaveCount(0);
  });

  test('creates a market order session with quote freshness metadata after a fresh MFA login', async ({
    page,
  }) => {
    test.slow();
    test.setTimeout(150_000);

    await bootstrapFreshLiveOrderSession(page);
    await page.getByTestId('external-order-preset-krx-market-buy-3').click();
    await expect(page.getByTestId('order-session-selected-summary')).toContainText('시장가');

    const createOrderSessionResponsePromise = page.waitForResponse(
      (response) =>
        response.url().includes('/api/v1/orders/sessions')
        && !response.url().includes('/execute')
        && response.request().method() === 'POST',
    );
    await page.getByTestId('order-session-create').click();
    const createOrderSessionResponse = await createOrderSessionResponsePromise;
    expect(createOrderSessionResponse.ok()).toBe(true);
    expectCorrelationHeaders(await createOrderSessionResponse.allHeaders());

    const createdSessionPayload = await createOrderSessionResponse.json() as {
      data?: {
        orderType?: string | null;
        price?: number | null;
        quoteSnapshotId?: string | null;
        quoteAsOf?: string | null;
        quoteSourceMode?: string | null;
      };
    };
    expect(createdSessionPayload.data?.orderType).toBe('MARKET');
    expect(createdSessionPayload.data?.price ?? null).toBeNull();
    expectLiveQuoteMetadata(createdSessionPayload);

    await expect(page.getByTestId('order-session-summary')).toContainText(/상태 (AUTHED|PENDING_NEW)/);
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
