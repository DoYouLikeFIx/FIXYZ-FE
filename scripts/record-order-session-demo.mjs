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
const outputPath = path.join(outputDir, 'fe-order-session-demo.mp4');
const host = '127.0.0.1';
const port = Number(process.env.FE_DEMO_PORT ?? '4276');
const baseURL = `http://${host}:${port}`;

let viteProcess = null;
let createdViteProcess = false;
const LOGIN_TOKEN = 'login-fe-demo-token';

const demoCredentials = {
  email: 'order-stepup@fix.com',
  password: 'Test1234!',
  name: 'Order Step-Up Demo',
};

const member = {
  memberUuid: 'member-order-demo',
  email: demoCredentials.email,
  name: demoCredentials.name,
  role: 'ROLE_USER',
  totpEnrolled: true,
  accountId: '12',
};

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

const installMockRoutes = async (page) => {
  let sessionAuthenticated = false;
  let csrfCounter = 0;
  let orderSession = null;
  let pendingLoginToken = null;

  const nextCsrfToken = () => `csrf-token-${++csrfCounter}`;
  const nextExpiry = () => new Date(Date.now() + 5 * 60 * 1000).toISOString();
  const buildOrderSessionResponse = (session) => ({
    orderSessionId: session.orderSessionId,
    clOrdId: session.clOrdId,
    status: session.status,
    challengeRequired: session.challengeRequired,
    authorizationReason: session.authorizationReason,
    accountId: session.accountId,
    symbol: session.symbol,
    side: session.side,
    orderType: session.orderType,
    qty: session.qty,
    price: session.price,
    executionResult: session.executionResult ?? null,
    executedQty: session.executedQty ?? null,
    leavesQty: session.leavesQty ?? null,
    executedPrice: session.executedPrice ?? null,
    externalOrderId: session.externalOrderId ?? null,
    failureReason: session.failureReason ?? null,
    executedAt: session.executedAt ?? null,
    canceledAt: session.canceledAt ?? null,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    expiresAt: session.expiresAt,
    remainingSeconds: Math.max(0, Math.floor((Date.parse(session.expiresAt) - Date.now()) / 1000)),
  });

  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const { method, pathname } = {
      method: request.method(),
      pathname: url.pathname,
    };

    if (method === 'GET' && pathname === '/api/v1/auth/session') {
      await route.fulfill({
        status: sessionAuthenticated ? 200 : 401,
        contentType: 'application/json',
        body: JSON.stringify(
          sessionAuthenticated
            ? createSuccessEnvelope(member)
            : createDirectError('AUTH-003', 'Authentication required', pathname),
        ),
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

    if (method === 'POST' && pathname === '/api/v1/auth/login') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createSuccessEnvelope({
          loginToken: LOGIN_TOKEN,
          nextAction: 'VERIFY_TOTP',
          totpEnrolled: true,
          expiresAt: nextExpiry(),
        })),
      });
      pendingLoginToken = LOGIN_TOKEN;
      return;
    }

    if (method === 'POST' && pathname === '/api/v1/auth/otp/verify') {
      const body = request.postDataJSON();
      const otpCode = String(body.otpCode ?? '');
      const loginToken = String(body.loginToken ?? '');

      if (loginToken !== pendingLoginToken || otpCode !== '123456') {
        await route.fulfill({
          status: 422,
          contentType: 'application/json',
          body: JSON.stringify(createDirectError('CHANNEL-002', 'OTP mismatch', pathname)),
        });
        return;
      }

      sessionAuthenticated = true;
      pendingLoginToken = null;
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

    if (method === 'POST' && pathname === '/api/v1/orders/sessions') {
      const body = request.postDataJSON();
      const now = new Date().toISOString();
      orderSession = {
        orderSessionId: 'ord-sess-fe-demo',
        clOrdId: request.headers()['x-clordid'] ?? 'cl-fe-demo',
        status: 'PENDING_NEW',
        challengeRequired: true,
        authorizationReason: 'ELEVATED_ORDER_RISK',
        accountId: Number(body.accountId ?? 12),
        symbol: String(body.symbol ?? '005930'),
        side: String(body.side ?? 'BUY'),
        orderType: String(body.orderType ?? 'LIMIT'),
        qty: Number(body.qty ?? 1),
        price: Number(body.price ?? 70100),
        createdAt: now,
        updatedAt: now,
        expiresAt: nextExpiry(),
      };

      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify(createSuccessEnvelope(buildOrderSessionResponse(orderSession))),
      });
      return;
    }

    const orderSessionMatch = pathname.match(/^\/api\/v1\/orders\/sessions\/([^/]+)$/);
    if (method === 'GET' && orderSessionMatch) {
      if (!orderSession || orderSession.orderSessionId !== orderSessionMatch[1]) {
        await route.fulfill({
          status: 404,
          contentType: 'application/json',
          body: JSON.stringify(createDirectError('ORD-008', 'Order session not found', pathname)),
        });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createSuccessEnvelope(buildOrderSessionResponse(orderSession))),
      });
      return;
    }

    const otpVerifyMatch = pathname.match(/^\/api\/v1\/orders\/sessions\/([^/]+)\/otp\/verify$/);
    if (method === 'POST' && otpVerifyMatch) {
      const { otpCode } = request.postDataJSON();
      if (!orderSession || orderSession.orderSessionId !== otpVerifyMatch[1]) {
        await route.fulfill({
          status: 404,
          contentType: 'application/json',
          body: JSON.stringify(createDirectError('ORD-008', 'Order session not found', pathname)),
        });
        return;
      }

      if (String(otpCode ?? '') !== '123456') {
        await route.fulfill({
          status: 422,
          contentType: 'application/json',
          body: JSON.stringify(createDirectError('CHANNEL-002', 'OTP mismatch', pathname)),
        });
        return;
      }

      orderSession = {
        ...orderSession,
        status: 'AUTHED',
        challengeRequired: false,
        updatedAt: new Date().toISOString(),
      };

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createSuccessEnvelope(buildOrderSessionResponse(orderSession))),
      });
      return;
    }

    const executeMatch = pathname.match(/^\/api\/v1\/orders\/sessions\/([^/]+)\/execute$/);
    if (method === 'POST' && executeMatch) {
      if (!orderSession || orderSession.orderSessionId !== executeMatch[1]) {
        await route.fulfill({
          status: 404,
          contentType: 'application/json',
          body: JSON.stringify(createDirectError('ORD-008', 'Order session not found', pathname)),
        });
        return;
      }

      orderSession = {
        ...orderSession,
        status: 'COMPLETED',
        executionResult: 'FILLED',
        executedQty: orderSession.qty,
        leavesQty: 0,
        executedPrice: orderSession.price,
        externalOrderId: 'ext-fe-demo-001',
        executedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createSuccessEnvelope(buildOrderSessionResponse(orderSession))),
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
    slowMo: 130,
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

    await page.goto('/login?redirect=/orders');
    await page.getByTestId('login-email').waitFor();
    await wait(900);

    await page.getByTestId('login-email').click();
    await page.getByTestId('login-email').pressSequentially(demoCredentials.email, { delay: 60 });
    await wait(300);
    await page.getByTestId('login-password').click();
    await page.getByTestId('login-password').pressSequentially(demoCredentials.password, { delay: 60 });
    await wait(300);
    await page.getByTestId('login-submit').click();
    await page.getByTestId('login-mfa-input').waitFor();
    await wait(1_200);

    await page.getByTestId('login-mfa-input').click();
    await page.getByTestId('login-mfa-input').pressSequentially('123456', { delay: 85 });
    await wait(300);
    await page.getByTestId('login-mfa-submit').click();
    await page.getByTestId('order-session-create').waitFor();
    await wait(1_200);
    await page.getByTestId('order-session-create').click();
    await page.getByTestId('order-session-otp-input').waitFor();
    await wait(1_500);

    await page.getByTestId('order-session-otp-input').click();
    await page.getByTestId('order-session-otp-input').pressSequentially('123456', { delay: 85 });
    await page.getByTestId('order-session-execute').waitFor();
    await wait(1_400);

    await page.getByTestId('order-session-execute').click();
    await page.getByTestId('external-order-feedback').waitFor();
    await wait(2_000);

    await page.close();
  } finally {
    await context.close();
    await browser.close();
  }
};

await ensureDir(outputDir);
await startViteIfNeeded();

const videoTempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fixyz-fe-order-demo-'));

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
