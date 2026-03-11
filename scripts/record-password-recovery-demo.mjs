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
const outputPath = path.join(outputDir, 'fe-password-recovery-demo.mp4');
const host = '127.0.0.1';
const port = Number(process.env.FE_DEMO_PORT ?? '4273');
const baseURL = `http://${host}:${port}`;
const proxyTarget = process.env.VITE_DEV_PROXY_TARGET ?? 'http://127.0.0.1:8080';

let viteProcess = null;
let createdViteProcess = false;

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
    env: {
      ...process.env,
      VITE_DEV_PROXY_TARGET: proxyTarget,
    },
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

const installMockRoutes = async (page) => {
  await page.route('**/api/v1/auth/session', async (route) => {
    await route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({
        code: 'AUTH-003',
        message: 'Authentication required',
        path: '/api/v1/auth/session',
        correlationId: 'corr-session',
      }),
    });
  });

  await page.route('**/api/v1/auth/csrf', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          csrfToken: 'csrf-token',
          headerName: 'X-CSRF-TOKEN',
        },
        error: null,
      }),
    });
  });

  await page.route('**/api/v1/auth/password/forgot/challenge', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          challengeToken: 'challenge-token',
          challengeType: 'captcha',
          challengeTtlSeconds: 300,
        },
        error: null,
      }),
    });
  });

  await page.route('**/api/v1/auth/password/forgot', async (route) => {
    await route.fulfill({
      status: 202,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          accepted: true,
          message: 'If the account is eligible, a reset email will be sent.',
          recovery: {
            challengeEndpoint: '/api/v1/auth/password/forgot/challenge',
            challengeMayBeRequired: true,
          },
        },
        error: null,
      }),
    });
  });

  await page.route('**/api/v1/auth/password/reset', async (route) => {
    await route.fulfill({
      status: 204,
      body: '',
    });
  });
};

const recordDemo = async () => {
  await ensureDir(outputDir);
  const videoTempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fixyz-fe-demo-'));

  const browser = await chromium.launch({
    headless: true,
    slowMo: 120,
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
  const page = await context.newPage();
  const video = page.video();

  await installMockRoutes(page);

  await page.goto('/login');
  await wait(500);

  await page.getByTestId('login-email').click();
  await page.getByTestId('login-email').pressSequentially('demo@fix.com', { delay: 70 });
  await wait(500);

  await page.getByTestId('login-open-password-recovery').click();
  await wait(700);

  await page.getByTestId('forgot-password-submit').click();
  await wait(1_000);

  await page.getByTestId('forgot-password-bootstrap-challenge').click();
  await wait(800);

  await page.getByTestId('forgot-password-challenge-answer').click();
  await page.getByTestId('forgot-password-challenge-answer').pressSequentially('ready', {
    delay: 90,
  });
  await wait(400);

  await page.getByTestId('forgot-password-submit').click();
  await wait(1_100);

  await page.goto('/reset-password?token=reset-token');
  await wait(700);

  await page.getByTestId('reset-password-new-password').click();
  await page.getByTestId('reset-password-new-password').pressSequentially('Test1234!', {
    delay: 85,
  });
  await wait(500);

  await page.getByTestId('reset-password-submit').click();
  await wait(1_400);

  await context.close();
  await browser.close();

  const webmPath = await video.path();
  await runCommand('ffmpeg', [
    '-y',
    '-i',
    webmPath,
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    outputPath,
  ]);
};

try {
  await startViteIfNeeded();
  await recordDemo();
  console.log(outputPath);
} finally {
  await stopViteIfNeeded();
}
