import { expect, test, type Page } from '@playwright/test';

import { requireLiveAuthContractHealthy } from './_shared/liveAuthContract';

const INVALID_CREDENTIALS_MESSAGE = '이메일 또는 비밀번호가 올바르지 않습니다.';
const DEFAULT_REGISTER_PASSWORD = 'LiveTest1!';
const DEFAULT_INVALID_PASSWORD = 'DefinitelyWrong1!';
const DEFAULT_RESET_PASSWORD = 'FreshLive1!';

const createLiveIdentity = () => {
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;

  return {
    email: `live_${suffix}@example.com`,
    name: `Live ${suffix}`,
    password: process.env.LIVE_REGISTER_PASSWORD ?? DEFAULT_REGISTER_PASSWORD,
  };
};

const goToLogin = async (page: Page) => {
  await page.goto('/login');
  await expect(page.getByTestId('login-email')).toBeVisible();
};

const goToRegister = async (page: Page) => {
  await page.goto('/register');
  await expect(page.getByTestId('register-email')).toBeVisible();
};

test.describe.serial('live backend auth', () => {
  const identity = createLiveIdentity();
  const liveResetToken = process.env.LIVE_RESET_TOKEN?.trim();
  const liveResetPassword = process.env.LIVE_RESET_PASSWORD ?? DEFAULT_RESET_PASSWORD;

  test.beforeEach(async ({ request }) => {
    await requireLiveAuthContractHealthy(request);
  });

  test('registers a fresh account through the live backend', async ({ page }) => {
    await goToRegister(page);
    await page.getByTestId('register-email').fill(identity.email);
    await page.getByTestId('register-name').fill(identity.name);
    await page.getByTestId('register-password').fill(identity.password);
    await page.getByTestId('register-password-confirm').fill(identity.password);
    await page.getByTestId('register-submit').click();

    await expect(page).toHaveURL(/\/settings\/totp\/enroll(?:\?.*)?$/);
    await expect(page.getByTestId('totp-enroll-manual-key')).toBeVisible();
  });

  test('logs in with the live backend account created earlier', async ({ page }) => {
    await goToLogin(page);
    await page.getByTestId('login-email').fill(identity.email);
    await page.getByTestId('login-password').fill(identity.password);
    await page.getByTestId('login-submit').click();

    await expect(page).toHaveURL(/\/settings\/totp\/enroll(?:\?.*)?$/);
    await expect(page.getByTestId('totp-enroll-manual-key')).toBeVisible();
  });

  test('shows the canonical invalid credentials message for the registered live account', async ({
    page,
  }) => {
    await goToLogin(page);
    await page.getByTestId('login-email').fill(identity.email);
    await page.getByTestId('login-password').fill(process.env.LIVE_INVALID_PASSWORD ?? DEFAULT_INVALID_PASSWORD);
    await page.getByTestId('login-submit').click();

    await expect(page.getByTestId('error-message')).toHaveText(INVALID_CREDENTIALS_MESSAGE);
    await expect(page.getByTestId('login-submit')).toBeVisible();
  });

  test('submits the live forgot-password flow with deterministic acceptance guidance', async ({
    page,
  }) => {
    await goToLogin(page);
    await page.getByTestId('login-email').fill(identity.email);
    await page.getByTestId('login-open-password-recovery').click();

    await expect(page).toHaveURL(/\/forgot-password/);
    await expect(page.getByTestId('forgot-password-email')).toHaveValue(identity.email);

    await page.getByTestId('forgot-password-submit').click();

    await expect(page.getByTestId('forgot-password-accepted')).toContainText(
      'If the account is eligible, a reset email will be sent.',
    );
  });

  test('bootstraps the live recovery challenge contract after the accepted forgot flow', async ({
    page,
  }) => {
    await goToLogin(page);
    await page.getByTestId('login-email').fill(identity.email);
    await page.getByTestId('login-open-password-recovery').click();

    await expect(page).toHaveURL(/\/forgot-password/);
    await page.getByTestId('forgot-password-submit').click();

    await expect(page.getByTestId('forgot-password-accepted')).toContainText(
      'If the account is eligible, a reset email will be sent.',
    );

    await page.getByTestId('forgot-password-bootstrap-challenge').click();
    await expect(page.getByTestId('forgot-password-challenge-state')).toBeVisible();
  });

  test('shows deterministic invalid-reset guidance from the live backend', async ({
    page,
  }) => {
    await page.goto('/reset-password?token=definitely-invalid-reset-token');
    await expect(page.getByTestId('reset-password-new-password')).toBeVisible();
    await expect(page).toHaveURL(/\/reset-password$/);

    await page.getByTestId('reset-password-new-password').fill('FreshLive1!');
    await page.getByTestId('reset-password-submit').click();

    await expect(page.getByTestId('reset-password-error')).toHaveText(
      '재설정 링크가 유효하지 않거나 만료되었습니다. 비밀번호 재설정을 다시 요청해 주세요.',
    );
    await expect(page.getByTestId('reset-password-submit')).toBeVisible();
  });

  test('completes the live reset-password handoff when a live token is provided', async ({
    page,
  }) => {
    test.skip(!liveResetToken, 'LIVE_RESET_TOKEN is required for the live reset-success path.');

    await page.goto(`/reset-password?token=${encodeURIComponent(liveResetToken!)}`);
    await expect(page.getByTestId('reset-password-new-password')).toBeVisible();

    await page.getByTestId('reset-password-new-password').fill(liveResetPassword);
    await page.getByTestId('reset-password-submit').click();

    await expect(page).toHaveURL(/\/login\?recovery=reset-success/);
    await expect(page.getByTestId('password-reset-success')).toContainText(
      '비밀번호가 변경되었습니다. 새 비밀번호로 로그인해 주세요.',
    );
  });
});
