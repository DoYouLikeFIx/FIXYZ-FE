import fs from 'node:fs/promises';
import path from 'node:path';

import { chromium } from '@playwright/test';

const demoBaseUrl = process.env.DEMO_BASE_URL ?? 'http://127.0.0.1:14173';
const videoDir = process.env.DEMO_VIDEO_DIR
  ?? path.resolve(process.cwd(), '.tmp-fe-video', 'raw');

const wait = (ms) => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

const smoothScrollBy = async (page, distance, steps = 6, pauseMs = 180) => {
  const stepDistance = Math.round(distance / steps);

  for (let step = 0; step < steps; step += 1) {
    await page.mouse.wheel(0, stepDistance);
    await wait(pauseMs);
  }
};

const smoothScrollIntoView = async (page, selector, block = 'center') => {
  await page.locator(selector).evaluate((element, scrollBlock) => {
    element.scrollIntoView({
      behavior: 'smooth',
      block: scrollBlock,
      inline: 'nearest',
    });
  }, block);
  await wait(1200);
};

const ensureDirectory = async (directoryPath) => {
  await fs.mkdir(directoryPath, { recursive: true });
};

const loginToDemoAccount = async (context) => {
  const csrfResponse = await context.request.get(`${demoBaseUrl}/api/v1/auth/csrf`);
  const csrfPayload = await csrfResponse.json();
  const csrfToken = csrfPayload?.data?.csrfToken ?? csrfPayload?.data?.token;

  if (!csrfToken) {
    throw new Error('Failed to fetch CSRF token for FE demo recording.');
  }

  const loginResponse = await context.request.post(`${demoBaseUrl}/api/v1/auth/login`, {
    form: {
      email: 'demo@fix.com',
      password: 'Test1234!',
    },
    headers: {
      'X-XSRF-TOKEN': csrfToken,
    },
  });

  if (!loginResponse.ok()) {
    throw new Error(`FE demo login failed with status ${loginResponse.status()}.`);
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

await ensureDirectory(videoDir);

const browser = await chromium.launch({
  headless: true,
});

const context = await browser.newContext({
  viewport: {
    width: 1440,
    height: 1080,
  },
  recordVideo: {
    dir: videoDir,
    size: {
      width: 1440,
      height: 1080,
    },
  },
});

try {
  await loginToDemoAccount(context);

  const page = await context.newPage();

  await page.goto(`${demoBaseUrl}/portfolio`, {
    waitUntil: 'networkidle',
  });
  await page.waitForSelector('[data-testid="portfolio-total-balance"]');
  await wait(1200);

  await page.click('[data-testid="portfolio-symbol-000660"]');
  await page.waitForSelector('text=현재 조회 종목');
  await wait(1400);

  await page.click('[data-testid="portfolio-tab-history"]');
  await page.waitForSelector('[data-testid="order-list"]');
  await wait(1000);

  await smoothScrollBy(page, 320, 5, 220);
  await wait(500);

  await page.click('[data-testid="portfolio-history-size-5"]');
  await wait(1200);

  await page.click('[data-testid="portfolio-history-next"]');
  await wait(1500);

  await smoothScrollBy(page, 560, 7, 220);
  await smoothScrollIntoView(page, '[data-testid="order-row-cl-portfolio-006"]');
  await wait(1500);

  await page.close();
} finally {
  await context.close();
  await browser.close();
}

const recordedVideoPath = await findRecordedVideo(videoDir);
process.stdout.write(`${recordedVideoPath}\n`);
