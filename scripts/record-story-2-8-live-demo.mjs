#!/usr/bin/env node

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
  process.env.FE_STORY_2_8_LIVE_OUTPUT_BASENAME ?? '2-8-fe-portfolio-pnl-live-be-flow';
const outputPath = path.join(outputDir, `${outputBasename}.mp4`);
const posterPath = path.join(outputDir, `${outputBasename}-poster.png`);
const videoLeadTrimSeconds =
  process.env.FE_STORY_2_8_LIVE_LEAD_TRIM_SECONDS?.trim() || '0.5';
const liveApiBaseUrl = process.env.LIVE_API_BASE_URL?.trim() || 'http://127.0.0.1:8080';
const host = '127.0.0.1';
const port = Number(process.env.FE_STORY_2_8_LIVE_PORT ?? '4280');
const baseURL = `http://${host}:${port}`;

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

const centerLocator = async (locator, pauseMs = 900) => {
  await locator.waitFor({ timeout: 30_000 });
  await locator.evaluate((element) => {
    element.scrollIntoView({
      block: 'center',
      inline: 'nearest',
      behavior: 'auto',
    });
  });
  await wait(pauseMs);
};

const centerTestId = async (page, testId, pauseMs = 900) => {
  await centerLocator(page.getByTestId(testId), pauseMs);
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
    password: process.env.LIVE_REGISTER_PASSWORD ?? 'LiveVideo28!',
    emailPrefix: 'story2_8_fe_video',
    namePrefix: 'Story 2.8 FE',
  });

  const browser = await chromium.launch({
    headless: true,
    slowMo: 120,
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

    await page.goto('/portfolio');
    await page.getByTestId('portfolio-total-balance').waitFor({ timeout: 30_000 });
    await page.getByTestId('portfolio-dashboard-quote-ticker').waitFor({ timeout: 30_000 });
    await wait(700);

    await centerTestId(page, 'portfolio-total-balance', 900);
    await centerTestId(page, 'portfolio-valuation-status', 900);
    await centerTestId(page, 'portfolio-market-price', 900);
    await centerTestId(page, 'portfolio-unrealized-pnl', 900);
    await centerTestId(page, 'portfolio-realized-pnl-daily', 900);
    await centerTestId(page, 'portfolio-quote-as-of', 900);
    await centerTestId(page, 'portfolio-dashboard-quote-ticker', 1_000);
    await centerTestId(page, 'portfolio-dashboard-quote-ticker-state', 900);
    await centerTestId(page, 'portfolio-dashboard-quote-ticker-guidance', 900);

    const valuationGuidance = page.getByTestId('portfolio-valuation-guidance');

    if (await valuationGuidance.count()) {
      await centerLocator(valuationGuidance, 1_000);
    }

    await page.getByTestId('portfolio-demo-order').click();
    await page.getByTestId('external-order-preset-krx-market-buy-3').waitFor({ timeout: 30_000 });
    await page.getByTestId('external-order-preset-krx-market-buy-3').click();
    await page.getByTestId('market-order-live-ticker').waitFor({ timeout: 30_000 });
    await centerTestId(page, 'market-order-live-ticker', 1_000);
    await centerTestId(page, 'market-order-live-ticker-quote-as-of', 900);
    await centerTestId(page, 'market-order-live-ticker-guidance', 900);

    await page.getByTestId('order-session-create').click();
    await page.getByTestId('order-session-summary').waitFor({ timeout: 30_000 });
    await centerTestId(page, 'order-session-summary', 1_600);

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

const videoTempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fixyz-fe-story-2-8-live-'));

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
