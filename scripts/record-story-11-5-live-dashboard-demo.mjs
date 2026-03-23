#!/usr/bin/env node

import { createHmac } from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';
import {
  createProvisionedStory115DashboardAccount,
} from '../../scripts/story-11-5-live-dashboard-account.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const feRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(feRoot, '..');

const outputDir = path.resolve(
  process.cwd(),
  process.argv[2] ?? path.join(repoRoot, '_bmad-output/implementation-artifacts/media'),
);
const outputBasename =
  process.env.FE_STORY_11_5_LIVE_OUTPUT_BASENAME ?? '11-5-fe-dashboard-chart-live-be-flow';
const outputPath = path.join(outputDir, `${outputBasename}.mp4`);
const posterPath = path.join(outputDir, `${outputBasename}-poster.png`);
const videoLeadTrimSeconds = process.env.FE_STORY_11_5_LIVE_LEAD_TRIM_SECONDS?.trim() || '0.5';
const liveApiBaseUrl = process.env.LIVE_API_BASE_URL?.trim() || 'http://127.0.0.1:8080';
const host = '127.0.0.1';
const port = Number(process.env.FE_STORY_11_5_LIVE_PORT ?? '4278');
const baseURL = `http://${host}:${port}`;
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

let viteProcess = null;

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

const startVite = async () => {
  viteProcess = spawn(
    'pnpm',
    ['exec', 'vite', '--host', host, '--port', String(port), '--strictPort'],
    {
      cwd: feRoot,
      stdio: 'ignore',
      env: {
        ...process.env,
        VITE_DEV_PROXY_TARGET: liveApiBaseUrl,
      },
    },
  );

  await waitForServer(30_000);
};

const stopVite = async () => {
  if (!viteProcess || viteProcess.exitCode !== null) {
    return;
  }

  viteProcess.kill('SIGTERM');
  await wait(1_000);

  if (viteProcess.exitCode === null) {
    viteProcess.kill('SIGKILL');
  }
};

const decodeBase32 = (value) => {
  const normalized = value.trim().replace(/=/g, '').toUpperCase();
  let buffer = 0;
  let bitsLeft = 0;
  const output = [];

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

const generateTotp = (manualEntryKey, now = Date.now()) => {
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

const millisUntilNextTotpWindow = (now = Date.now()) => 30_000 - (now % 30_000);

const generateStableTotp = async (manualEntryKey) => {
  if (millisUntilNextTotpWindow() < 8_000) {
    await wait(millisUntilNextTotpWindow() + 1_500);
  }

  return generateTotp(manualEntryKey);
};

class LiveCookieJar {
  constructor() {
    this.cookies = new Map();
  }

  rememberFromHeaders(headers) {
    const raw = headers.get('set-cookie');

    if (!raw) {
      return;
    }

    for (const entry of raw.split(/,(?=[^;]+=[^;]+)/g)) {
      const [pair, ...attributes] = entry.split(';').map((value) => value.trim());
      const separatorIndex = pair.indexOf('=');

      if (separatorIndex <= 0) {
        continue;
      }

      const name = pair.slice(0, separatorIndex);
      const value = pair.slice(separatorIndex + 1);
      const metadata = {
        value,
        path: '/',
        httpOnly: false,
        secure: false,
        sameSite: 'Lax',
      };

      for (const attribute of attributes) {
        const [attributeName, attributeValue] = attribute.split('=');
        const normalizedName = attributeName.toLowerCase();

        if (normalizedName === 'path' && attributeValue) {
          metadata.path = attributeValue;
        }
        if (normalizedName === 'httponly') {
          metadata.httpOnly = true;
        }
        if (normalizedName === 'secure') {
          metadata.secure = true;
        }
        if (normalizedName === 'samesite' && attributeValue) {
          metadata.sameSite = this.normalizeSameSite(attributeValue);
        }
      }

      this.cookies.set(name, metadata);
    }
  }

  setCookie(name, value, overrides = {}) {
    this.cookies.set(name, {
      value,
      path: overrides.path ?? '/',
      httpOnly: overrides.httpOnly ?? false,
      secure: overrides.secure ?? false,
      sameSite: this.normalizeSameSite(overrides.sameSite ?? 'Lax'),
    });
  }

  normalizeSameSite(value) {
    const normalized = String(value).toLowerCase();

    if (normalized === 'strict') {
      return 'Strict';
    }
    if (normalized === 'none') {
      return 'None';
    }
    return 'Lax';
  }

  toCookieHeader() {
    return [...this.cookies.entries()]
      .map(([name, metadata]) => `${name}=${metadata.value}`)
      .join('; ');
  }

  toPlaywrightCookies() {
    const hostname = new URL(liveApiBaseUrl).hostname;

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

const fetchLiveJson = async (cookieJar, requestPath, init, timeoutMs) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const headers = new Headers(init.headers);
  const cookieHeader = cookieJar.toCookieHeader();

  if (cookieHeader) {
    headers.set('Cookie', cookieHeader);
  }

  try {
    const response = await fetch(`${liveApiBaseUrl}${requestPath}`, {
      ...init,
      headers,
      signal: controller.signal,
    });

    cookieJar.rememberFromHeaders(response.headers);

    if (!response.ok) {
      throw new Error(`${requestPath} returned ${response.status}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timer);
  }
};

const fetchLiveCsrf = async (cookieJar) => {
  const payload = await fetchLiveJson(
    cookieJar,
    '/api/v1/auth/csrf',
    { method: 'GET' },
    60_000,
  );
  const csrfToken = payload.data?.csrfToken ?? payload.data?.token;

  if (!csrfToken) {
    throw new Error('Live csrf bootstrap did not return a token.');
  }

  cookieJar.setCookie('XSRF-TOKEN', csrfToken, { sameSite: 'Strict' });

  return {
    csrfToken,
    headerName: payload.data?.headerName ?? 'X-CSRF-TOKEN',
  };
};

const createLiveIdentity = () => {
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;

  return {
    email: `story11_5_video_${suffix}@example.com`,
    name: `Story 11.5 ${suffix}`,
    password: process.env.LIVE_REGISTER_PASSWORD ?? 'LiveVideo115!',
  };
};

const bootstrapFreshSession = async (page) => {
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
  const loginPayload = await fetchLiveJson(
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

  if (!loginToken) {
    throw new Error('Live login did not return a loginToken.');
  }

  const enrollPayload = await fetchLiveJson(
    cookieJar,
    '/api/v1/members/me/totp/enroll',
    {
      method: 'POST',
      headers: {
        [csrf.headerName]: csrf.csrfToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ loginToken }),
    },
    60_000,
  );
  const manualEntryKey = enrollPayload.data?.manualEntryKey ?? '';
  const enrollmentToken = enrollPayload.data?.enrollmentToken ?? '';

  if (!manualEntryKey || !enrollmentToken) {
    throw new Error('Live TOTP enrollment bootstrap did not return manualEntryKey/enrollmentToken.');
  }

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
};

const centerTestId = async (page, testId) => {
  const locator = page.getByTestId(testId);
  await locator.waitFor();
  await locator.evaluate((element) => {
    element.scrollIntoView({
      block: 'center',
      inline: 'nearest',
      behavior: 'auto',
    });
  });
  await wait(900);
};

const provisionPosition = async (page) => {
  await page.goto('/orders');
  await page.getByTestId('order-session-create').waitFor();
  await page.getByTestId('external-order-preset-krx-buy-5').waitFor();
  await page.getByTestId('external-order-preset-krx-buy-5').click();
  await wait(700);

  const createOrderSessionResponsePromise = page.waitForResponse(
    (response) =>
      response.url().includes('/api/v1/orders/sessions')
      && !response.url().includes('/execute')
      && response.request().method() === 'POST',
  );
  await page.getByTestId('order-session-create').click();
  await createOrderSessionResponsePromise;
  await page.getByTestId('order-session-execute').waitFor();
  await wait(700);

  const executeOrderSessionResponsePromise = page.waitForResponse(
    (response) =>
      response.url().includes('/api/v1/orders/sessions/')
      && response.url().includes('/execute')
      && response.request().method() === 'POST',
  );
  await page.getByTestId('order-session-execute').click();
  await executeOrderSessionResponsePromise;
  await page.getByTestId('order-session-summary').waitFor();
  await wait(1_400);
};

const ensureDashboardChart = async (page) => {
  await page.goto('/portfolio');
  await page.getByTestId('portfolio-market-price').waitFor({ timeout: 30_000 });
  await page.getByTestId('portfolio-dashboard-quote-ticker-chart').waitFor({ timeout: 30_000 });
  await centerTestId(page, 'portfolio-dashboard-quote-ticker-chart');
};

const findRecordedVideo = async (directoryPath) => {
  const files = await fs.readdir(directoryPath);
  const webmFile = files.find((fileName) => fileName.endsWith('.webm'));

  if (!webmFile) {
    throw new Error(`No recorded Playwright video found in ${directoryPath}.`);
  }

  return path.join(directoryPath, webmFile);
};

const recordDemo = async (videoTempDir) => {
  const provisioned = await createProvisionedStory115DashboardAccount({
    baseUrl: liveApiBaseUrl,
    password: process.env.LIVE_REGISTER_PASSWORD ?? 'LiveVideo115!',
    emailPrefix: 'story11_5_fe_video',
    namePrefix: 'Story 11.5 FE',
  });

  const browser = await chromium.launch({
    headless: true,
    slowMo: 140,
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
    await page.context().clearCookies();
    await page.context().addCookies(
      provisioned.cookieJar.toPlaywrightCookies(liveApiBaseUrl),
    );
    await ensureDashboardChart(page);
    await wait(1_000);

    await page.getByTestId('portfolio-demo-order').click();
    await page.getByTestId('external-order-preset-krx-market-buy-3').waitFor({ timeout: 30_000 });
    await page.getByTestId('external-order-preset-krx-market-buy-3').click();
    await page.getByTestId('market-order-live-ticker-quote-as-of').waitFor({ timeout: 30_000 });
    await centerTestId(page, 'market-order-live-ticker-quote-as-of');
    await wait(1_400);

    const createOrderSessionResponsePromise = page.waitForResponse(
      (response) =>
        response.url().includes('/api/v1/orders/sessions')
        && !response.url().includes('/execute')
        && response.request().method() === 'POST',
    );
    await page.getByTestId('order-session-create').click();
    await createOrderSessionResponsePromise;
    await page.getByTestId('order-session-summary').waitFor({ timeout: 30_000 });
    await wait(2_400);

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
await startVite();

const videoTempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fixyz-fe-story-11-5-live-'));

try {
  await recordDemo(videoTempDir);
  const recordedVideoPath = await findRecordedVideo(videoTempDir);

  await runCommand('ffmpeg', [
    '-y',
    '-i',
    recordedVideoPath,
    '-ss',
    videoLeadTrimSeconds,
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
  await stopVite();
}
