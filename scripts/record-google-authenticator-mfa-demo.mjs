#!/usr/bin/env node

import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const feRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(feRoot, '..');
const outputDir = path.resolve(
  process.cwd(),
  process.argv[2] ?? path.join(repoRoot, '_bmad-output/implementation-artifacts/demos'),
);
const outputPath = path.join(outputDir, 'fe-google-authenticator-mfa-demo.mp4');
const host = '127.0.0.1';
const port = Number(process.env.FE_DEMO_PORT ?? '4275');
const baseURL = `http://${host}:${port}`;

let viteProcess = null;
let createdViteProcess = false;

const demoCredentials = {
  email: 'new-mfa-demo@fix.com',
  password: 'Test1234!',
  name: 'MFA Demo User',
};

const member = {
  memberUuid: 'member-mfa-demo',
  email: demoCredentials.email,
  name: demoCredentials.name,
  role: 'ROLE_USER',
  totpEnrolled: false,
  accountId: '1',
};

const positionRows = [
  {
    accountId: 1,
    memberId: 1,
    symbol: '005930',
    quantity: 18,
    availableQuantity: 18,
    availableQty: 18,
    balance: 128500000,
    availableBalance: 128500000,
    currency: 'KRW',
    asOf: '2026-03-12T09:10:00Z',
  },
  {
    accountId: 1,
    memberId: 1,
    symbol: '000660',
    quantity: 7,
    availableQuantity: 7,
    availableQty: 7,
    balance: 128500000,
    availableBalance: 128500000,
    currency: 'KRW',
    asOf: '2026-03-12T09:10:00Z',
  },
];

const orderHistory = Array.from({ length: 8 }, (_, index) => ({
  symbol: index % 2 === 0 ? '005930' : '000660',
  symbolName: index % 2 === 0 ? '삼성전자' : 'SK하이닉스',
  side: index % 3 === 0 ? 'SELL' : 'BUY',
  qty: (index % 4) + 1,
  unitPrice: 70_100 + index * 120,
  totalAmount: (70_100 + index * 120) * ((index % 4) + 1),
  status: index % 5 === 0 ? 'CANCELED' : 'FILLED',
  clOrdId: `cl-mfa-demo-${index + 1}`,
  createdAt: `2026-03-12T0${Math.min(index, 9)}:00:00Z`,
}));

const wait = (ms) => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

const runCommand = (command, args, options = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      ...options,
    });

    let stderr = '';

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} ${args.join(' ')} failed with code ${code}\n${stderr}`));
    });
  });

const ensureDir = async (dirPath) => {
  await fs.mkdir(dirPath, { recursive: true });
};

const isServerReachable = async () => {
  try {
    const response = await fetch(baseURL, { redirect: 'manual' });
    return response.ok || response.status === 404;
  } catch {
    return false;
  }
};

const waitForServer = async (timeoutMs) => {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await isServerReachable()) {
      return;
    }

    if (viteProcess && viteProcess.exitCode !== null) {
      throw new Error(`Vite dev server exited early with code ${viteProcess.exitCode}.`);
    }

    await wait(250);
  }

  throw new Error(`Timed out waiting for ${baseURL}.`);
};

const startViteIfNeeded = async () => {
  if (await isServerReachable()) {
    return;
  }

  viteProcess = spawn('pnpm', [
    'exec',
    'vite',
    '--host',
    host,
    '--port',
    String(port),
    '--strictPort',
  ], {
    cwd: feRoot,
    stdio: 'ignore',
  });
  createdViteProcess = true;

  await waitForServer(30_000);
};

const stopViteIfNeeded = async () => {
  if (!createdViteProcess || !viteProcess || viteProcess.exitCode !== null) {
    return;
  }

  viteProcess.kill('SIGTERM');
  await wait(1_000);

  if (viteProcess.exitCode === null) {
    viteProcess.kill('SIGKILL');
  }
};

const findRecordedVideo = async (directoryPath) => {
  const files = await fs.readdir(directoryPath);
  const webmFile = files.find((fileName) => fileName.endsWith('.webm'));

  if (!webmFile) {
    throw new Error(`No recorded Playwright video found in ${directoryPath}.`);
  }

  return path.join(directoryPath, webmFile);
};

const createDirectError = (code, message, pathName) => ({
  code,
  message,
  path: pathName,
  correlationId: `corr-${code.toLowerCase()}`,
});

const createSuccessEnvelope = (data) => ({
  success: true,
  data,
  error: null,
});

const createPagedOrders = (page, size) => {
  const start = page * size;
  const content = orderHistory.slice(start, start + size);

  return {
    content,
    totalElements: orderHistory.length,
    totalPages: Math.ceil(orderHistory.length / size),
    number: page,
    size,
  };
};

const installMockRoutes = async (page) => {
  let sessionAuthenticated = false;
  let csrfCounter = 0;
  let registered = false;
  let enrollmentAttempt = 0;

  const nextExpiry = () => new Date(Date.now() + 5 * 60 * 1000).toISOString();
  const nextCsrfToken = () => `csrf-token-${++csrfCounter}`;
  const nextEnrollmentPayload = () => {
    const payloads = [
      {
        secret: 'JBSWY3DPEHPK3PXP',
        manualEntryKey: 'JBSW Y3DP EHPK 3PXP',
      },
      {
        secret: 'KRUGS4ZANFZSAYJA',
        manualEntryKey: 'KRUG S4ZA NFZS AYJA',
      },
    ];
    const current = payloads[Math.min(enrollmentAttempt, payloads.length - 1)];
    enrollmentAttempt += 1;
    return current;
  };

  await page.addInitScript(() => {
    class DemoEventSource {
      constructor() {
        this.readyState = 1;
        this.onopen = null;
        this.onerror = null;
        this.onmessage = null;
      }

      addEventListener() {}

      removeEventListener() {}

      close() {
        this.readyState = 2;
      }
    }

    window.EventSource = DemoEventSource;
  });

  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const { method, pathname, searchParams } = {
      method: request.method(),
      pathname: url.pathname,
      searchParams: url.searchParams,
    };

    if (method === 'GET' && pathname === '/api/v1/auth/session') {
      if (!sessionAuthenticated) {
        await route.fulfill({
          status: 401,
          contentType: 'application/json',
          body: JSON.stringify(createDirectError('AUTH-003', 'Authentication required', pathname)),
        });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createSuccessEnvelope(member)),
      });
      return;
    }

    if (method === 'GET' && pathname === '/api/v1/auth/csrf') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createSuccessEnvelope({
            csrfToken: nextCsrfToken(),
            headerName: 'X-CSRF-TOKEN',
          })),
      });
      return;
    }

    if (method === 'POST' && pathname === '/api/v1/auth/register') {
      registered = true;
      member.totpEnrolled = false;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createSuccessEnvelope(member)),
      });
      return;
    }

    if (method === 'POST' && pathname === '/api/v1/auth/login') {
      if (!registered || !member.totpEnrolled) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(createSuccessEnvelope({
            loginToken: 'login-token-enroll',
            nextAction: 'ENROLL_TOTP',
            totpEnrolled: false,
            expiresAt: nextExpiry(),
            enrollUrl: '/settings/totp/enroll',
          })),
        });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createSuccessEnvelope({
          loginToken: 'login-token-verify',
          nextAction: 'VERIFY_TOTP',
          totpEnrolled: true,
          expiresAt: nextExpiry(),
        })),
      });
      return;
    }

    if (method === 'POST' && pathname === '/api/v1/members/me/totp/enroll') {
      const enrollment = nextEnrollmentPayload();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createSuccessEnvelope({
          enrollmentToken: `enrollment-token-${enrollmentAttempt}`,
          qrUri: `otpauth://totp/FIXYZ:${encodeURIComponent(member.email)}?secret=${enrollment.secret}&issuer=FIXYZ&period=30&digits=6`,
          manualEntryKey: enrollment.manualEntryKey,
          expiresAt: nextExpiry(),
        })),
      });
      return;
    }

    if (method === 'POST' && pathname === '/api/v1/members/me/totp/confirm') {
      sessionAuthenticated = true;
      member.totpEnrolled = true;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createSuccessEnvelope(member)),
      });
      return;
    }

    if (method === 'POST' && pathname === '/api/v1/auth/otp/verify') {
      sessionAuthenticated = true;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createSuccessEnvelope(member)),
      });
      return;
    }

    if (!sessionAuthenticated) {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify(createDirectError('AUTH-003', 'Authentication required', pathname)),
      });
      return;
    }

    if (method === 'GET' && pathname === '/api/v1/accounts/1/summary') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createSuccessEnvelope(positionRows[0])),
      });
      return;
    }

    if (method === 'GET' && pathname === '/api/v1/accounts/1/positions/list') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createSuccessEnvelope(positionRows)),
      });
      return;
    }

    if (method === 'GET' && pathname === '/api/v1/accounts/1/positions') {
      const symbol = searchParams.get('symbol') ?? '005930';
      const matched = positionRows.find((row) => row.symbol === symbol) ?? {
        ...positionRows[0],
        symbol,
      };

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createSuccessEnvelope(matched)),
      });
      return;
    }

    if (method === 'GET' && pathname === '/api/v1/accounts/1/orders') {
      const pageNumber = Number(searchParams.get('page') ?? '0');
      const pageSize = Number(searchParams.get('size') ?? '10');

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createSuccessEnvelope(createPagedOrders(pageNumber, pageSize))),
      });
      return;
    }

    await route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify(createDirectError('NOT_FOUND', 'Not found', pathname)),
    });
  });
};

const recordDemo = async (videoTempDir) => {
  const browser = await chromium.launch({
    headless: true,
    slowMo: 140,
  });

  const context = await browser.newContext({
    baseURL,
    colorScheme: 'light',
    locale: 'ko-KR',
    viewport: { width: 1440, height: 960 },
    recordVideo: {
      dir: videoTempDir,
      size: { width: 1440, height: 960 },
    },
  });

  try {
    const page = await context.newPage();
    await installMockRoutes(page);

    await page.goto('/register');
    await page.getByTestId('register-email').waitFor();
    await wait(900);

    await page.getByTestId('register-email').click();
    await page.getByTestId('register-email').pressSequentially(demoCredentials.email, { delay: 55 });
    await wait(250);
    await page.getByTestId('register-name').click();
    await page.getByTestId('register-name').pressSequentially(demoCredentials.name, { delay: 55 });
    await wait(250);
    await page.getByTestId('register-password').click();
    await page.getByTestId('register-password').pressSequentially(demoCredentials.password, { delay: 55 });
    await wait(250);
    await page.getByTestId('register-password-confirm').click();
    await page.getByTestId('register-password-confirm').pressSequentially(demoCredentials.password, { delay: 55 });
    await wait(350);
    await page.getByTestId('register-submit').click();

    await page.getByTestId('totp-enroll-qr-image').waitFor();
    await wait(1_400);
    await page.locator('[data-testid="totp-enroll-qr-image"]').hover();
    await wait(1_200);
    await page.getByTestId('totp-enroll-reset').click();
    await page.getByTestId('login-email').waitFor();
    await wait(900);

    await page.getByTestId('login-email').click();
    await page.getByTestId('login-email').pressSequentially(demoCredentials.email, { delay: 65 });
    await wait(250);
    await page.getByTestId('login-password').click();
    await page.getByTestId('login-password').pressSequentially(demoCredentials.password, { delay: 65 });
    await wait(250);
    await page.getByTestId('login-submit').click();

    await page.getByTestId('totp-enroll-qr-image').waitFor();
    await wait(1_400);
    await page.locator('[data-testid="totp-enroll-qr-image"]').hover();
    await wait(1_200);
    await page.getByTestId('totp-enroll-code').click();
    await page.getByTestId('totp-enroll-code').pressSequentially('123456', { delay: 80 });
    await wait(500);
    await page.getByTestId('totp-enroll-submit').click();
    await page.getByTestId('protected-area-title').waitFor();
    await wait(1_500);
    await page.getByTestId('portfolio-tab-history').click();
    await page.getByTestId('order-list').waitFor();
    await wait(2_000);

    await page.close();
  } finally {
    await context.close();
    await browser.close();
  }
};

await ensureDir(outputDir);
await startViteIfNeeded();

const videoTempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fixyz-fe-mfa-demo-'));

try {
  await recordDemo(videoTempDir);
  const recordedVideoPath = await findRecordedVideo(videoTempDir);

  await runCommand('ffmpeg', [
    '-y',
    '-i',
    recordedVideoPath,
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    outputPath,
  ]);

  process.stdout.write(`${outputPath}\n`);
} finally {
  await stopViteIfNeeded();
}
