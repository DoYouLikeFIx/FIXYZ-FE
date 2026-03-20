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
const outputPath = path.join(outputDir, 'fe-password-recovery-live-be.mp4');
const host = '127.0.0.1';
const port = Number(process.env.FE_DEMO_PORT ?? '4275');
const baseURL = `http://${host}:${port}`;
const liveBackendBaseUrl = process.env.LIVE_API_BASE_URL ?? 'http://127.0.0.1:18081';
const demoEmail = process.env.LIVE_EMAIL ?? 'video_demo@example.com';

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
      LIVE_API_BASE_URL: liveBackendBaseUrl,
      VITE_DEV_PROXY_TARGET: liveBackendBaseUrl,
      VITE_API_BASE_URL: '',
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

const setOverlay = async (page, label) => {
  await page.evaluate((overlayLabel) => {
    let overlay = document.getElementById('codex-demo-overlay');

    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'codex-demo-overlay';
      overlay.style.position = 'fixed';
      overlay.style.top = '18px';
      overlay.style.right = '18px';
      overlay.style.zIndex = '9999';
      overlay.style.padding = '10px 14px';
      overlay.style.borderRadius = '12px';
      overlay.style.background = 'rgba(15, 23, 42, 0.92)';
      overlay.style.color = '#f8fafc';
      overlay.style.font = '600 14px ui-monospace, SFMono-Regular, Menlo, monospace';
      overlay.style.boxShadow = '0 12px 30px rgba(15, 23, 42, 0.24)';
      overlay.style.maxWidth = '42vw';
      overlay.style.pointerEvents = 'none';
      document.body.appendChild(overlay);
    }

    overlay.textContent = overlayLabel;
  }, label);
};

const bridgeRequestToLiveBackend = async (route) => {
    const request = route.request();
    const requestUrl = new URL(request.url());
    const targetUrl = new URL(`${requestUrl.pathname}${requestUrl.search}`, liveBackendBaseUrl).toString();
    const headers = { ...request.headers() };

    delete headers.host;
    delete headers.origin;
    delete headers.referer;
    delete headers['content-length'];

    const response = await fetch(targetUrl, {
      method: request.method(),
      headers,
      body: request.postDataBuffer() ?? undefined,
      redirect: 'manual',
    });

    const body = Buffer.from(await response.arrayBuffer());
    await route.fulfill({
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body,
    });
};

const installBackendBridge = async (page) => {
  await page.route('**/api/v1/auth/session', async (route) => {
    await route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({
        code: 'AUTH-003',
        message: 'Authentication required',
        path: '/api/v1/auth/session',
        correlationId: 'fe-live-recovery-demo-session',
      }),
    });
  });

  await page.route('**/api/v1/auth/csrf', bridgeRequestToLiveBackend);
  await page.route('**/api/v1/auth/password/forgot', bridgeRequestToLiveBackend);
  await page.route('**/api/v1/auth/password/forgot/challenge', bridgeRequestToLiveBackend);
};

const recordDemo = async () => {
  await ensureDir(outputDir);
  const videoTempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fixyz-fe-live-recovery-demo-'));

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
  const page = await context.newPage();
  const video = page.video();
  await installBackendBridge(page);

  await page.goto('/login');
  await page.getByTestId('login-email').waitFor();
  await setOverlay(page, `BE-FE live demo | /login | ${liveBackendBaseUrl}`);
  await wait(500);

  await page.getByTestId('login-email').click();
  await page.getByTestId('login-email').pressSequentially(demoEmail, { delay: 75 });
  await wait(350);

  await page.getByTestId('login-open-password-recovery').click();
  await page.waitForURL('**/forgot-password?**');
  await setOverlay(page, 'BE-FE live demo | /forgot-password | initial request');
  await wait(600);

  await page.getByTestId('forgot-password-submit').click();
  await page.getByTestId('forgot-password-accepted').waitFor();
  await setOverlay(page, 'BE-FE live demo | accepted guidance from BE');
  await wait(900);

  await page.getByTestId('forgot-password-bootstrap-challenge').click();
  await page.getByTestId('forgot-password-challenge-state').waitFor();
  await setOverlay(page, 'BE-FE live demo | challenge bootstrap -> proof-of-work');
  await wait(700);

  const legacyInput = page.getByTestId('forgot-password-challenge-answer');
  if (await legacyInput.count()) {
    await legacyInput.click();
    await legacyInput.pressSequentially('ready', { delay: 90 });
    await wait(300);
  } else {
    await page.getByTestId('forgot-password-challenge-state').getByText('계산 완료').waitFor({
      timeout: 10_000,
    });
    await setOverlay(page, 'BE-FE live demo | local solve complete -> submit verify');
    await wait(700);
  }

  await page.getByTestId('forgot-password-submit').click();
  await page.getByTestId('forgot-password-accepted').waitFor();
  await page.getByTestId('forgot-password-challenge-state').waitFor({ state: 'hidden', timeout: 2_500 }).catch(() => {});
  await setOverlay(page, 'BE-FE live demo | BE verify success -> 202 Accepted');
  await wait(1_300);

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
