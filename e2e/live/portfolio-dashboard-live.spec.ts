import { expect, test, type Page } from '@playwright/test';

const DEFAULT_REGISTER_PASSWORD = 'LiveTest1!';
const MASKED_ACCOUNT_PATTERN = /(^\*\*\*-[*\d]{4}$)|(^\d{3}-\*{4}-\d{4}$)/;

const createLiveIdentity = () => {
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;

  return {
    email: `portfolio_live_${suffix}@example.com`,
    name: `Portfolio Live ${suffix}`,
    password: process.env.LIVE_REGISTER_PASSWORD ?? DEFAULT_REGISTER_PASSWORD,
  };
};

const goToRegister = async (page: Page) => {
  await page.goto('/register');
  await expect(page.getByTestId('register-email')).toBeVisible();
};

test.describe('live backend portfolio dashboard', () => {
  const identity = createLiveIdentity();

  test('registers a fresh live account and renders dashboard/history data from the live backend', async ({
    page,
  }) => {
    await goToRegister(page);

    await page.getByTestId('register-email').fill(identity.email);
    await page.getByTestId('register-name').fill(identity.name);
    await page.getByTestId('register-password').fill(identity.password);
    await page.getByTestId('register-password-confirm').fill(identity.password);
    await page.getByTestId('register-submit').click();

    await expect(page).toHaveURL(/\/portfolio$/);
    await expect(page.getByTestId('protected-area-title')).toHaveText('Portfolio overview');
    await expect(page.getByTestId('portfolio-demo-order')).toBeVisible();
    await expect(page.getByTestId('portfolio-masked-account')).toHaveText(MASKED_ACCOUNT_PATTERN);
    await expect(page.getByTestId('portfolio-symbol-error')).toHaveCount(0);
    await expect(page.getByTestId('portfolio-summary-error')).toHaveCount(0);
    await expect(page.getByTestId('portfolio-total-balance')).toBeVisible();
    await expect(page.getByTestId('portfolio-available-quantity')).toBeVisible();

    await page.getByTestId('portfolio-tab-history').click();

    await expect(page.getByTestId('portfolio-history-error')).toHaveCount(0);
    await expect(page.getByTestId('portfolio-history-page-indicator')).toHaveText(/^\d+ \/ \d+$/);
    await expect(page.getByTestId('order-list-empty')).toHaveText(
      '아직 주문 내역이 없습니다.',
    );
  });
});
