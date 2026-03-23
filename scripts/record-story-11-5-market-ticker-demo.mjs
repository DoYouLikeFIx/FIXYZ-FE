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
  process.argv[2] ?? path.join(repoRoot, '_bmad-output/implementation-artifacts/media'),
);
const outputBasename =
  process.env.FE_STORY_11_5_MARKET_TICKER_OUTPUT_BASENAME ?? '11-5-fe-market-ticker-runtime-flow';
const outputPath = path.join(outputDir, `${outputBasename}.mp4`);
const posterPath = path.join(outputDir, `${outputBasename}-poster.png`);
const host = '127.0.0.1';
const port = Number(process.env.FE_STORY_11_5_MARKET_TICKER_PORT ?? '4278');
const baseURL = `http://${host}:${port}`;

let viteProcess = null;
let createdViteProcess = false;

const wait = (ms) => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

const successEnvelope = (data) => ({
  success: true,
  data,
  error: null,
});

const errorEnvelope = (error) => ({
  success: false,
  data: null,
  error: {
    timestamp: '2026-03-23T00:00:00.000Z',
    ...error,
  },
});

const member = {
  memberUuid: 'member-story-11-5-fe-market-ticker',
  email: 'quote-story@fix.com',
  name: 'Quote Freshness Demo',
  role: 'ROLE_USER',
  totpEnrolled: true,
  accountId: '14',
};

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

const installMockRoutes = async (page) => {
  let csrfCounter = 0;
  let tickerRequestCount = 0;
  const nextCsrfToken = () => `csrf-story-11-5-fe-market-ticker-${++csrfCounter}`;

  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const pathname = url.pathname;
    const method = request.method();

    if (method === 'GET' && pathname === '/api/v1/auth/session') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(successEnvelope(member)),
      });
      return;
    }

    if (method === 'GET' && pathname === '/api/v1/auth/csrf') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(successEnvelope({
          csrfToken: nextCsrfToken(),
          headerName: 'X-CSRF-TOKEN',
        })),
      });
      return;
    }

    if (method === 'GET' && pathname === '/api/v1/accounts/14/summary') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(successEnvelope({
          accountId: 14,
          memberId: 14,
          symbol: '',
          quantity: 0,
          availableQuantity: 0,
          availableQty: 0,
          balance: 100_000_000,
          availableBalance: 100_000_000,
          currency: 'KRW',
          asOf: '2026-03-23T09:00:00Z',
        })),
      });
      return;
    }

    if (method === 'GET' && pathname === '/api/v1/accounts/14/positions/list') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(successEnvelope([
          {
            accountId: 14,
            memberId: 14,
            symbol: '005930',
            quantity: 120,
            availableQuantity: 20,
            availableQty: 20,
            balance: 100_000_000,
            availableBalance: 100_000_000,
            currency: 'KRW',
            asOf: '2026-03-23T09:00:00Z',
            marketPrice: 70_100,
            quoteSnapshotId: 'qsnap-live-001',
            quoteAsOf: '2026-03-23T09:00:00Z',
            quoteSourceMode: 'LIVE',
          },
          {
            accountId: 14,
            memberId: 14,
            symbol: '000660',
            quantity: 15,
            availableQuantity: 7,
            availableQty: 7,
            balance: 98_500_000,
            availableBalance: 98_500_000,
            currency: 'KRW',
            asOf: '2026-03-23T09:00:00Z',
            marketPrice: 194_000,
            quoteSnapshotId: 'qsnap-delayed-001',
            quoteAsOf: '2026-03-23T08:45:00Z',
            quoteSourceMode: 'DELAYED',
          },
          {
            accountId: 14,
            memberId: 14,
            symbol: '035420',
            quantity: 9,
            availableQuantity: 4,
            availableQty: 4,
            balance: 97_100_000,
            availableBalance: 97_100_000,
            currency: 'KRW',
            asOf: '2026-03-23T09:00:00Z',
            marketPrice: 223_000,
            quoteSnapshotId: 'qsnap-replay-001',
            quoteAsOf: '2026-03-23T08:00:00Z',
            quoteSourceMode: 'REPLAY',
          },
        ])),
      });
      return;
    }

    if (method === 'GET' && pathname === '/api/v1/accounts/14/positions') {
      tickerRequestCount += 1;
      const isReplayTick = tickerRequestCount > 1;

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(successEnvelope({
          accountId: 14,
          memberId: 14,
          symbol: url.searchParams.get('symbol') ?? '005930',
          quantity: 120,
          availableQuantity: 20,
          availableQty: 20,
          balance: 100_000_000,
          availableBalance: 100_000_000,
          currency: 'KRW',
          asOf: '2026-03-23T09:00:00Z',
          marketPrice: isReplayTick ? 70_300 : 70_100,
          quoteSnapshotId: isReplayTick ? 'qsnap-replay-001' : 'qsnap-live-001',
          quoteAsOf: isReplayTick ? '2026-03-23T09:05:00Z' : '2026-03-23T09:00:00Z',
          quoteSourceMode: isReplayTick ? 'REPLAY' : 'LIVE',
        })),
      });
      return;
    }

    if (method === 'GET' && pathname === '/api/v1/accounts/14/orders') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(successEnvelope({
          content: [],
          totalElements: 0,
          totalPages: 0,
          number: 0,
          size: 10,
        })),
      });
      return;
    }

    if (method === 'POST' && pathname === '/api/v1/orders/sessions') {
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify(errorEnvelope({
          code: 'VALIDATION-003',
          message: '시장가 주문에 사용할 시세가 오래되었습니다.',
          detail: '시장가 주문에 사용한 quote snapshot이 허용 범위를 초과했습니다.',
          operatorCode: 'STALE_QUOTE',
          userMessageKey: 'error.quote.stale',
          details: {
            symbol: '005930',
            quoteSnapshotId: 'qsnap-replay-001',
            quoteSourceMode: 'REPLAY',
            snapshotAgeMs: 65_000,
          },
        })),
      });
      return;
    }

    await route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify(errorEnvelope({
        code: 'NOT_FOUND',
        message: 'Not found',
        detail: pathname,
      })),
    });
  });
};

const recordDemo = async (videoTempDir) => {
  const browser = await chromium.launch({
    headless: true,
    slowMo: 160,
  });

  const context = await browser.newContext({
    baseURL,
    colorScheme: 'light',
    locale: 'ko-KR',
    viewport: { width: 1600, height: 1024 },
    recordVideo: {
      dir: videoTempDir,
      size: { width: 1600, height: 1024 },
    },
  });

  try {
    const page = await context.newPage();
    await installMockRoutes(page);

    await page.goto('/orders');
    await page.getByTestId('external-order-preset-krx-market-buy-3').waitFor();
    await wait(700);

    await page.getByTestId('external-order-preset-krx-market-buy-3').click();
    await page.getByTestId('market-order-live-ticker').waitFor();
    await wait(1_500);

    await page.getByTestId('market-order-live-ticker-source-mode').waitFor();
    await wait(5_700);

    await page.getByTestId('order-session-create').click();
    await page.getByTestId('order-session-stale-quote-guidance').waitFor();
    await wait(2_000);

    await page.screenshot({
      path: posterPath,
      fullPage: false,
    });
    await page.close();
  } finally {
    await context.close();
    await browser.close();
  }
};

await ensureDir(outputDir);
await startViteIfNeeded();

const videoTempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fixyz-fe-story-11-5-market-ticker-'));

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
