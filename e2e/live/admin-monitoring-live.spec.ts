import { spawnSync } from 'node:child_process';
import { createHmac } from 'node:crypto';

import { expect, test, type Page } from '@playwright/test';

import { requireLiveAuthContractHealthy } from './_shared/liveAuthContract';

const DEFAULT_REGISTER_PASSWORD = 'LiveAdminMonitoring1!';
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const MONITORING_PANEL_KEYS = [
  'executionVolume',
  'pendingSessions',
  'marketDataIngest',
] as const;
const LIVE_ADMIN_EMAIL = process.env.LIVE_ADMIN_EMAIL?.trim();
const LIVE_ADMIN_PASSWORD = process.env.LIVE_ADMIN_PASSWORD?.trim();
const LIVE_ADMIN_OTP = process.env.LIVE_ADMIN_OTP?.trim();
const LIVE_ADMIN_TOTP_SECRET = process.env.LIVE_ADMIN_TOTP_SECRET?.trim();
const LIVE_CHANNEL_DB_CONTAINER = process.env.LIVE_CHANNEL_DB_CONTAINER?.trim() || 'mysql';
const LIVE_CHANNEL_DB_USER = process.env.LIVE_CHANNEL_DB_USER?.trim() || 'fix';
const LIVE_CHANNEL_DB_PASSWORD = process.env.LIVE_CHANNEL_DB_PASSWORD?.trim() || 'fix';
const LIVE_CHANNEL_DB_NAME = process.env.LIVE_CHANNEL_DB_NAME?.trim() || 'channel_db';
const LIVE_BACKEND_BASE_URL = (
  process.env.LIVE_API_BASE_URL?.trim()
  || process.env.VITE_DEV_PROXY_TARGET?.trim()
  || 'http://127.0.0.1:8080'
).replace(/\/$/, '');
const monitoringConfigFromEnv = process.env.VITE_ADMIN_MONITORING_PANELS_JSON?.trim();

interface LiveIdentity {
  email: string;
  password: string;
  manualEntryKey: string;
  lastUsedTotp: string;
}

type MonitoringPanelKey = (typeof MONITORING_PANEL_KEYS)[number];

type MonitoringFreshnessStatus = 'live' | 'stale' | 'unavailable';

interface MonitoringPanelFreshness {
  indicatorLabel: string;
  lastUpdatedLabel: string;
  status: MonitoringFreshnessStatus;
  statusMessage?: string;
  lastUpdatedAt: string;
}

interface MonitoringPanelDescriptor {
  key: MonitoringPanelKey;
  mode: 'link' | 'embed';
  title: string;
  description: string;
  linkUrl: string;
  freshness: MonitoringPanelFreshness;
  embedUrl?: string;
  drillDown: {
    adminAuditUrl?: string;
  };
}

type MonitoringConfigResult =
  | {
      status: 'missing';
      message: string;
      panels: [];
    }
  | {
      status: 'invalid';
      message: string;
      panels: [];
    }
  | {
      status: 'ready';
      panels: MonitoringPanelDescriptor[];
    };

const createLiveIdentity = () => {
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;

  return {
    email: `admin_monitoring_live_${suffix}@example.com`,
    name: `Admin Monitoring Live ${suffix}`,
    password: process.env.LIVE_REGISTER_PASSWORD ?? DEFAULT_REGISTER_PASSWORD,
  };
};

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const isSafeExternalUrl = (value: unknown): value is string => {
  if (!isNonEmptyString(value)) {
    return false;
  }

  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
};

const isSafeAdminAuditUrl = (value: unknown): value is string => {
  if (!isNonEmptyString(value)) {
    return false;
  }

  try {
    const parsed = new URL(value, 'http://localhost');
    const eventType = parsed.searchParams.get('auditEventType');

    return parsed.origin === 'http://localhost'
      && parsed.pathname === '/admin'
      && (eventType === null || eventType.trim().length > 0);
  } catch {
    return false;
  }
};

const isValidTimestamp = (value: unknown): value is string =>
  isNonEmptyString(value) && !Number.isNaN(Date.parse(value));

const isMonitoringFreshness = (value: unknown): value is MonitoringPanelFreshness => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const freshness = value as Partial<MonitoringPanelFreshness>;

  return isNonEmptyString(freshness.indicatorLabel)
    && isNonEmptyString(freshness.lastUpdatedLabel)
    && (freshness.status === 'live'
      || freshness.status === 'stale'
      || freshness.status === 'unavailable')
    && isValidTimestamp(freshness.lastUpdatedAt)
    && (freshness.statusMessage === undefined || isNonEmptyString(freshness.statusMessage));
};

const isMonitoringPanelDescriptor = (value: unknown): value is MonitoringPanelDescriptor => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const descriptor = value as Partial<MonitoringPanelDescriptor>;
  const drillDown = descriptor.drillDown as { adminAuditUrl?: unknown } | undefined;

  return MONITORING_PANEL_KEYS.includes(descriptor.key as MonitoringPanelKey)
    && (descriptor.mode === 'link' || descriptor.mode === 'embed')
    && isNonEmptyString(descriptor.title)
    && isNonEmptyString(descriptor.description)
    && isSafeExternalUrl(descriptor.linkUrl)
    && isMonitoringFreshness(descriptor.freshness)
    && (descriptor.mode !== 'embed' || isSafeExternalUrl(descriptor.embedUrl))
    && (drillDown === undefined
      || typeof drillDown === 'object'
      && (drillDown.adminAuditUrl === undefined || isSafeAdminAuditUrl(drillDown.adminAuditUrl)));
};

const parseMonitoringDescriptors = (): MonitoringConfigResult => {
  if (!monitoringConfigFromEnv) {
    return {
      status: 'missing',
      message:
        '운영 모니터링 패널이 아직 구성되지 않았습니다. `VITE_ADMIN_MONITORING_PANELS_JSON`을 설정해 주세요.',
      panels: [],
    };
  }

  try {
    const parsed = JSON.parse(monitoringConfigFromEnv) as unknown;

    if (!Array.isArray(parsed)) {
      return {
        status: 'invalid',
        message: '`VITE_ADMIN_MONITORING_PANELS_JSON` must be a JSON array.',
        panels: [],
      };
    }

    if (!parsed.every(isMonitoringPanelDescriptor)) {
      return {
        status: 'invalid',
        message:
          '`VITE_ADMIN_MONITORING_PANELS_JSON` contains a descriptor with missing title/description/freshness or an unsafe URL.',
        panels: [],
      };
    }

    const seenKeys = new Set(parsed.map((descriptor) => descriptor.key));

    if (seenKeys.size !== parsed.length) {
      return {
        status: 'invalid',
        message: '`VITE_ADMIN_MONITORING_PANELS_JSON` contains duplicate monitoring keys.',
        panels: [],
      };
    }

    const hasAllKeys = MONITORING_PANEL_KEYS.every((key) => seenKeys.has(key));

    if (!hasAllKeys) {
      return {
        status: 'invalid',
        message: '`VITE_ADMIN_MONITORING_PANELS_JSON` must provide executionVolume, pendingSessions, and marketDataIngest.',
        panels: [],
      };
    }

    return {
      status: 'ready',
      panels: parsed,
    };
  } catch {
    return {
      status: 'invalid',
      message: '`VITE_ADMIN_MONITORING_PANELS_JSON` is not valid JSON.',
      panels: [],
    };
  }
};

const escapeSqlString = (value: string) =>
  value.replaceAll('\\', '\\\\').replaceAll("'", "''");

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

const waitForPath = async (page: Page, pathname: string, timeout = 20_000) => {
  await expect.poll(() => {
    const url = new URL(page.url());
    return url.pathname;
  }, {
    timeout,
    message: `Expected browser to navigate to ${pathname}.`,
  }).toBe(pathname);
};

const waitForLoginStep = async (
  page: Page,
  successPathname: string,
): Promise<'success' | 'mfa' | 'error'> => {
  const mfaInput = page.getByTestId('login-mfa-input');
  const loginError = page.getByTestId('error-message');
  const startedAt = Date.now();

  while (Date.now() - startedAt <= 15_000) {
    const pathname = new URL(page.url()).pathname;

    if (pathname === successPathname) {
      return 'success';
    }

    if (await mfaInput.isVisible().catch(() => false)) {
      return 'mfa';
    }

    if (await loginError.isVisible().catch(() => false)) {
      return 'error';
    }

    await delay(250);
  }

  throw new Error(`Expected login to reach ${successPathname}, show MFA challenge, or show a login error message within 15s.`);
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

const goToAdminLogin = async (page: Page) => {
  await page.goto('/login?redirect=%2Fadmin');
  await expect(page.getByTestId('login-email')).toBeVisible();
};

const goToAdminRegister = async (page: Page) => {
  await page.goto('/register?redirect=%2Fadmin');
  await expect(page.getByTestId('register-email')).toBeVisible();
};

const waitForOrderAuthorizationStep = async (
  page: Page,
  timeout = 30_000,
): Promise<'otp' | 'execute'> => {
  const startedAt = Date.now();
  const orderSessionOtpInput = page.getByTestId('order-session-otp-input');
  const executeButton = page.getByTestId('order-session-execute');

  while (Date.now() - startedAt <= timeout) {
    if (await orderSessionOtpInput.isVisible().catch(() => false)) {
      return 'otp';
    }

    if (await executeButton.isVisible().catch(() => false)) {
      return 'execute';
    }

    await delay(250);
  }

  throw new Error('Expected the order flow to show an OTP challenge or execute button within 30s.');
};

const requestAdminAuditStatus = async (page: Page) => {
  const response = await page.context().request.get(
    `${LIVE_BACKEND_BASE_URL}/api/v1/admin/audit-logs?page=0&size=20`,
    {
      failOnStatusCode: false,
    },
  );

  return {
    status: response.status(),
    body: await response.text(),
    headers: response.headers(),
  };
};

const registerFreshUserWithAdminRedirect = async (page: Page): Promise<LiveIdentity> => {
  const identity = createLiveIdentity();

  await goToAdminRegister(page);
  await page.getByTestId('register-email').fill(identity.email);
  await page.getByTestId('register-name').fill(identity.name);
  await page.getByTestId('register-password').fill(identity.password);
  await page.getByTestId('register-password-confirm').fill(identity.password);
  await page.getByTestId('register-submit').click();

  await expect(page).toHaveURL(/\/settings\/totp\/enroll(?:\?.*)?$/);
  await expect(page.getByTestId('totp-enroll-manual-key')).toBeVisible();

  const manualEntryKey = ((await page.getByTestId('totp-enroll-manual-key').textContent()) ?? '').trim();
  expect(manualEntryKey).toBeTruthy();

  const enrollmentCode = await generateStableTotp(manualEntryKey);
  await page.getByTestId('totp-enroll-code').fill(enrollmentCode);
  await page.getByTestId('totp-enroll-submit').click();

  await waitForPath(page, '/portfolio');

  return {
    ...identity,
    manualEntryKey,
    lastUsedTotp: enrollmentCode,
  };
};

const createExecutedOrderForIdentity = async (
  page: Page,
  identity: LiveIdentity,
): Promise<LiveIdentity> => {
  await page.goto('/orders');
  await expect(page.getByTestId('protected-area-title')).toHaveText('Session-based order flow');
  await expect(page.getByTestId('order-session-create')).toBeVisible();
  await expect(page.getByTestId('order-session-selected-summary')).toContainText('005930');

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

  let nextIdentity = identity;
  const authorizationStep = await waitForOrderAuthorizationStep(page);
  const orderSessionOtpInput = page.getByTestId('order-session-otp-input');

  if (authorizationStep === 'otp') {
    const orderOtpCode = await waitForNextTotp(identity.manualEntryKey, identity.lastUsedTotp);
    await orderSessionOtpInput.fill(orderOtpCode);
    nextIdentity = {
      ...identity,
      lastUsedTotp: orderOtpCode,
    };
  }

  await expect(page.getByTestId('order-session-execute')).toBeVisible({ timeout: 30_000 });

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
  await expect(page.getByTestId('order-session-summary')).toContainText('상태 COMPLETED', {
    timeout: 30_000,
  });

  await page.goto('/portfolio');
  await waitForPath(page, '/portfolio');
  return nextIdentity;
};

const loginProvisionedIdentityToAdmin = async (
  page: Page,
  identity: LiveIdentity,
): Promise<string> => {
  await goToAdminLogin(page);
  await page.getByTestId('login-email').fill(identity.email);
  await page.getByTestId('login-password').fill(identity.password);
  await page.getByTestId('login-submit').click();

  const loginStep = await waitForLoginStep(page, '/admin');

  if (loginStep === 'error') {
    const message = (await page.getByTestId('error-message').textContent())?.trim() ?? 'Unknown login error';
    throw new Error(`Provisioned admin password login failed before MFA: ${message}`);
  }

  if (loginStep !== 'mfa') {
    throw new Error('Expected provisioned admin login to require MFA verification.');
  }

  const mfaCode = await waitForNextTotp(identity.manualEntryKey, identity.lastUsedTotp);
  await page.getByTestId('login-mfa-input').fill(mfaCode);
  await page.getByTestId('login-mfa-submit').click();
  await waitForPath(page, '/admin');
  return mfaCode;
};

const promoteMemberToAdmin = (email: string) => {
  const sql = [
    `UPDATE members SET role='ROLE_ADMIN' WHERE email='${escapeSqlString(email)}';`,
    `SELECT role FROM members WHERE email='${escapeSqlString(email)}';`,
  ].join(' ');

  const result = spawnSync(
    'docker',
    [
      'exec',
      LIVE_CHANNEL_DB_CONTAINER,
      'mysql',
      `-u${LIVE_CHANNEL_DB_USER}`,
      `-p${LIVE_CHANNEL_DB_PASSWORD}`,
      '-N',
      '-B',
      '-D',
      LIVE_CHANNEL_DB_NAME,
      '-e',
      sql,
    ],
    {
      encoding: 'utf8',
    },
  );

  if (result.status !== 0) {
    throw new Error(
      `Failed to promote member to ROLE_ADMIN via local DB fixture: ${result.stderr || result.stdout || 'unknown error'}`,
    );
  }

  if (!result.stdout.includes('ROLE_ADMIN')) {
    throw new Error('Local DB fixture did not confirm ROLE_ADMIN promotion.');
  }
};

const cleanupProvisionedIdentity = (email: string) => {
  const escapedEmail = escapeSqlString(email);
  const sql = [
    `SET @member_id := (SELECT id FROM members WHERE email='${escapedEmail}' LIMIT 1);`,
    'DELETE FROM manual_recovery_queue_entries',
    ' WHERE order_session_id IN (SELECT order_session_id FROM order_sessions WHERE member_id = @member_id);',
    'DELETE FROM audit_logs',
    ' WHERE member_id = @member_id',
    '    OR order_session_id IN (SELECT id FROM order_sessions WHERE member_id = @member_id);',
    'DELETE FROM security_events',
    ' WHERE member_id = @member_id',
    '    OR admin_member_id = @member_id',
    '    OR order_session_id IN (SELECT id FROM order_sessions WHERE member_id = @member_id);',
    'DELETE FROM notifications WHERE member_id = @member_id;',
    'DELETE FROM otp_verifications WHERE member_id = @member_id;',
    'DELETE FROM password_reset_tokens WHERE member_id = @member_id;',
    'DELETE FROM order_sessions WHERE member_id = @member_id;',
    'DELETE FROM members WHERE id = @member_id;',
    `SELECT COUNT(*) FROM members WHERE email='${escapedEmail}';`,
  ].join(' ');

  const result = spawnSync(
    'docker',
    [
      'exec',
      LIVE_CHANNEL_DB_CONTAINER,
      'mysql',
      `-u${LIVE_CHANNEL_DB_USER}`,
      `-p${LIVE_CHANNEL_DB_PASSWORD}`,
      '-N',
      '-B',
      '-D',
      LIVE_CHANNEL_DB_NAME,
      '-e',
      sql,
    ],
    {
      encoding: 'utf8',
    },
  );

  if (result.status !== 0) {
    throw new Error(
      `Failed to clean up the provisioned live account via local DB fixture: ${result.stderr || result.stdout || 'unknown error'}`,
    );
  }

  const remainingCount = result.stdout
    .trim()
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .at(-1);

  if (remainingCount !== '0') {
    throw new Error(`Provisioned live account cleanup did not remove ${email}.`);
  }
};

const formatMonitoringTime = (value: string) =>
  new Intl.DateTimeFormat('ko-KR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));

const getMonitoringStatusText = (descriptor: MonitoringPanelDescriptor) =>
  descriptor.freshness.statusMessage ?? descriptor.freshness.indicatorLabel;

const getMonitoringLastUpdatedText = (descriptor: MonitoringPanelDescriptor) =>
  `${descriptor.freshness.lastUpdatedLabel}: ${formatMonitoringTime(descriptor.freshness.lastUpdatedAt)}`;

const loginWithLiveAdminToAdmin = async (page: Page) => {
  test.skip(
    !LIVE_ADMIN_EMAIL || !LIVE_ADMIN_PASSWORD,
    'LIVE_ADMIN_EMAIL and LIVE_ADMIN_PASSWORD are required for the live admin monitoring smoke path.',
  );

  await goToAdminLogin(page);
  await page.getByTestId('login-email').fill(LIVE_ADMIN_EMAIL!);
  await page.getByTestId('login-password').fill(LIVE_ADMIN_PASSWORD!);
  await page.getByTestId('login-submit').click();

  const loginStep = await waitForLoginStep(page, '/admin');

  if (loginStep === 'error') {
    const message = (await page.getByTestId('error-message').textContent())?.trim() ?? 'Unknown login error';
    throw new Error(`Live admin password login failed before MFA: ${message}`);
  }

  if (loginStep === 'mfa') {
    if (!LIVE_ADMIN_OTP && !LIVE_ADMIN_TOTP_SECRET) {
      throw new Error('LIVE_ADMIN_OTP or LIVE_ADMIN_TOTP_SECRET is required when the live admin account prompts MFA verification.');
    }

    const mfaInput = page.getByTestId('login-mfa-input');
    const maxAttempts = LIVE_ADMIN_TOTP_SECRET ? 3 : 1;
    let previousCode = '';
    let mfaPassed = false;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const mfaCode = LIVE_ADMIN_TOTP_SECRET
        ? (attempt === 1
          ? await generateStableTotp(LIVE_ADMIN_TOTP_SECRET)
          : await waitForNextTotp(LIVE_ADMIN_TOTP_SECRET, previousCode))
        : LIVE_ADMIN_OTP!;

      previousCode = mfaCode;
      await mfaInput.fill(mfaCode);
      await page.getByTestId('login-mfa-submit').click();

      const reachedAdmin = await expect.poll(() => {
        const url = new URL(page.url());
        return url.pathname === '/admin';
      }, {
        timeout: 8_000,
        message: `Expected browser to navigate to /admin after MFA attempt ${attempt}.`,
      }).toBeTruthy().then(() => true).catch(() => false);

      if (reachedAdmin) {
        mfaPassed = true;
        break;
      }
    }

    if (!mfaPassed) {
      const message = await page.getByTestId('login-mfa-error').textContent().catch(() => null);
      throw new Error(`Live admin MFA verification did not complete. ${message?.trim() ? `Server message: ${message.trim()}` : 'Check LIVE_ADMIN_TOTP_SECRET/LIVE_ADMIN_OTP validity and server clock skew.'}`);
    }
  }

  await waitForPath(page, '/admin');
};

test.describe.serial('live backend admin monitoring', () => {
  let provisionedIdentity: LiveIdentity | null = null;
  const monitoringDescriptors = parseMonitoringDescriptors();
  const usesProvisionedAdmin = !LIVE_ADMIN_EMAIL || !LIVE_ADMIN_PASSWORD;

  test.beforeEach(async ({ request }) => {
    await requireLiveAuthContractHealthy(request);
  });

  test.afterAll(async () => {
    if (provisionedIdentity) {
      cleanupProvisionedIdentity(provisionedIdentity.email);
    }
  });

  const ensureProvisionedIdentity = async (page: Page) => {
    if (provisionedIdentity) {
      return provisionedIdentity;
    }

    provisionedIdentity = await registerFreshUserWithAdminRedirect(page);
    provisionedIdentity = await createExecutedOrderForIdentity(page, provisionedIdentity);
    return provisionedIdentity;
  };

  test('redirects anonymous admin requests to login and preserves the original admin target', async ({
    page,
  }) => {
    const adminAudit = await requestAdminAuditStatus(page);
    expect(adminAudit.status).toBe(401);
    expect(adminAudit.body).toContain('AUTH-003');
    expectCorrelationHeaders(adminAudit.headers);

    await page.goto('/admin?auditEventType=ORDER_EXECUTE');

    await expect(page).toHaveURL(
      /\/login\?redirect=%2Fadmin%3FauditEventType%3DORDER_EXECUTE$/,
    );
    await expect(page.getByTestId('login-email')).toBeVisible();
    await expect(page.getByTestId('login-submit')).toBeVisible();
  });

  test('blocks a live ROLE_USER session from the admin console route and backend admin API', async ({ page }) => {
    const identity = await ensureProvisionedIdentity(page);
    provisionedIdentity = identity;

    await expect(page).toHaveURL(/\/portfolio$/);
    await expect(page.getByTestId('protected-area-title')).toHaveText('Portfolio overview');
    await expect(page.getByTestId('topbar-admin-link')).toHaveCount(0);

    const adminAudit = await requestAdminAuditStatus(page);
    expect(adminAudit.status).toBe(403);
    expectCorrelationHeaders(adminAudit.headers);

    await page.goto('/admin');

    await expect(page).toHaveURL(/\/portfolio$/);
    await expect(page.getByTestId('protected-area-title')).toHaveText('Portfolio overview');
  });

  test('renders the live admin console and reflects the active monitoring configuration', async ({
    page,
  }) => {
    const identity = await ensureProvisionedIdentity(page);

    if (LIVE_ADMIN_EMAIL && LIVE_ADMIN_PASSWORD) {
      await loginWithLiveAdminToAdmin(page);
    } else {
      promoteMemberToAdmin(identity.email);
      const loginCode = await loginProvisionedIdentityToAdmin(page, identity);
      provisionedIdentity = {
        ...identity,
        lastUsedTotp: loginCode,
      };
    }

    await expect(page.getByTestId('topbar-admin-link')).toBeVisible();
    await expect(page.getByTestId('admin-console-title')).toContainText('운영자 보안 및 모니터링 콘솔');

    if (monitoringDescriptors.status === 'invalid') {
      throw new Error(
        `Invalid live monitoring config: ${monitoringDescriptors.message}`,
      );
    }

    if (monitoringDescriptors.status === 'missing') {
      await expect(page.getByTestId('admin-monitoring-config-message')).toBeVisible();
      await expect(page.getByTestId('admin-monitoring-guidance-executionVolume')).toBeVisible();
      return;
    }

    const executionVolume = monitoringDescriptors.panels.find((descriptor) => descriptor.key === 'executionVolume');
    expect(executionVolume).toBeTruthy();
    const expectedAuditEventType = (() => {
      const adminAuditUrl = executionVolume!.drillDown.adminAuditUrl;

      if (!adminAuditUrl) {
        return 'ORDER_EXECUTE';
      }

      return new URL(adminAuditUrl, 'http://localhost').searchParams.get('auditEventType') ?? 'ORDER_EXECUTE';
    })();

    await expect(page.getByTestId('admin-monitoring-card-executionVolume')).toBeVisible();
    await expect(page.getByTestId('admin-monitoring-status-executionVolume')).toHaveText(
      getMonitoringStatusText(executionVolume!),
    );
    await expect(page.getByTestId('admin-monitoring-last-updated-executionVolume')).toHaveText(
      getMonitoringLastUpdatedText(executionVolume!),
    );
    await expect(page.getByTestId('admin-monitoring-open-executionVolume')).toHaveAttribute(
      'href',
      executionVolume!.linkUrl,
    );

    if (executionVolume!.mode === 'embed' && executionVolume!.embedUrl) {
      await expect(page.getByTestId('admin-monitoring-embed-executionVolume')).toHaveAttribute(
        'src',
        executionVolume!.embedUrl,
      );
    } else {
      await expect(page.getByTestId('admin-monitoring-link-mode-executionVolume')).toBeVisible();
    }

    const auditResponsePromise = page.waitForResponse(
      (response) =>
        response.url().includes('/api/v1/admin/audit-logs')
        && response.request().method() === 'GET'
        && new URL(response.url()).searchParams.get('eventType') === expectedAuditEventType,
    );

    await page.getByTestId('admin-monitoring-audit-executionVolume').click();

    const auditResponse = await auditResponsePromise;
    expect(auditResponse.ok()).toBe(true);
    expectCorrelationHeaders(await auditResponse.allHeaders());

    await expect(page).toHaveURL(
      new RegExp(`/admin\\?auditEventType=${expectedAuditEventType}$`),
    );
    await expect(page.getByTestId('admin-audit-event-type')).toHaveValue(expectedAuditEventType);
    await expect(page.getByTestId('admin-audit-count')).toBeVisible();
    await expect(page.getByTestId('admin-audit-error')).toHaveCount(0);

    if (usesProvisionedAdmin) {
      await expect.poll(
        async () => page.locator('[data-testid^="admin-audit-row-"]').filter({
          hasText: expectedAuditEventType,
        }).count(),
        {
          timeout: 15_000,
          message: `Expected at least one ${expectedAuditEventType} audit row for the provisioned admin fixture.`,
        },
      ).toBeGreaterThan(0);
    }
  });
});
