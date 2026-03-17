import { chromium } from '@playwright/test';
import { createHmac } from 'node:crypto';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

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

const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const email = `live_login_${suffix}@example.com`;
const name = `Live Login ${suffix}`;
const password = 'LiveNotification1!';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

await page.goto('http://127.0.0.1:4173/register?redirect=/orders', { timeout: 30000 });
await page.getByTestId('register-email').fill(email);
await page.getByTestId('register-name').fill(name);
await page.getByTestId('register-password').fill(password);
await page.getByTestId('register-password-confirm').fill(password);
await page.getByTestId('register-submit').click();
await page.waitForURL(/\/settings\/totp\/enroll/, { timeout: 45000 });

const manualKey = (await page.getByTestId('totp-enroll-manual-key').textContent())?.trim();
if (!manualKey) {
  throw new Error('Manual key missing after registration.');
}

const enrollmentCode = generateTotp(manualKey);
await page.getByTestId('totp-enroll-code').fill(enrollmentCode);
await page.getByTestId('totp-enroll-submit').click();
await page.waitForURL(/\/orders$/, { timeout: 45000 });

const loginOtp = generateTotp(manualKey);
const shouldPrintTotpSecret = process.env.SHOW_LIVE_LOGIN_TOTP_SECRET === 'true';

console.log(`LIVE_LOGIN_EMAIL=${email}`);
console.log(`LIVE_LOGIN_PASSWORD=${password}`);
console.log(`LIVE_LOGIN_OTP=${loginOtp}`);
if (shouldPrintTotpSecret) {
  console.log(`LIVE_LOGIN_TOTP_SECRET=${manualKey}`);
}

await browser.close();
