import { expect, test } from '@playwright/test';

const isLiveConfigured = Boolean(process.env.LIVE_API_BASE_URL?.trim());
const liveLoginEmail = process.env.LIVE_LOGIN_EMAIL?.trim();
const liveLoginPassword = process.env.LIVE_LOGIN_PASSWORD?.trim();
const liveLoginOtp = process.env.LIVE_LOGIN_OTP?.trim();

test.describe.serial('live notification center smoke', () => {
  test('enforces auth boundary for notification-center entry points against live backend', async ({
    page,
  }) => {
    test.skip(
      !isLiveConfigured,
      'LIVE_API_BASE_URL is required for live notification-center smoke execution.',
    );

    await page.goto('/portfolio');
    await expect(page).toHaveURL(/\/login/);

    const notificationListResponse = await page.request.get('/api/v1/notifications?limit=20');
    const notificationStreamResponse = await page.request.get('/api/v1/notifications/stream');

    expect([401, 403]).toContain(notificationListResponse.status());
    expect([401, 403]).toContain(notificationStreamResponse.status());
  });

  test('renders notification center after a live authenticated login', async ({ page }) => {
    test.skip(
      !isLiveConfigured || !liveLoginEmail || !liveLoginPassword,
      'LIVE_API_BASE_URL, LIVE_LOGIN_EMAIL, and LIVE_LOGIN_PASSWORD are required for live authenticated smoke execution.',
    );

    await page.goto('/login?redirect=/portfolio');
    await expect(page.getByTestId('login-email')).toBeVisible();

    await page.getByTestId('login-email').fill(liveLoginEmail!);
    await page.getByTestId('login-password').fill(liveLoginPassword!);
    await page.getByTestId('login-submit').click();

    const mfaInput = page.getByTestId('login-mfa-input');
    const mfaVisible = await mfaInput.isVisible({ timeout: 2_000 }).catch(() => false);

    if (mfaVisible) {
      if (!liveLoginOtp) {
        throw new Error('LIVE_LOGIN_OTP is required when live account login prompts MFA verification.');
      }

      await mfaInput.fill(liveLoginOtp);
      await page.getByTestId('login-mfa-submit').click();
    }

    await expect(page).toHaveURL(/\/portfolio$/);
    await expect(page.getByTestId('notification-center')).toBeVisible();

    const hasList = await page.getByTestId('notification-center-list').isVisible().catch(() => false);
    const hasEmpty = await page.getByTestId('notification-center-empty').isVisible().catch(() => false);
    const hasUnavailable = await page.getByTestId('notification-feed-unavailable').isVisible().catch(() => false);

    expect(hasList || hasEmpty || hasUnavailable).toBe(true);
  });
});
