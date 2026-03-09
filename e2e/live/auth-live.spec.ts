import { expect, test, type Page } from '@playwright/test';

const INVALID_CREDENTIALS_MESSAGE = '아이디 또는 비밀번호가 올바르지 않습니다.';
const DEFAULT_REGISTER_PASSWORD = 'LiveTest1!';
const DEFAULT_INVALID_PASSWORD = 'DefinitelyWrong1!';

const createLiveIdentity = () => {
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;

  return {
    username: `live_${suffix}`,
    email: `live_${suffix}@example.com`,
    name: `Live ${suffix}`,
    password: process.env.LIVE_REGISTER_PASSWORD ?? DEFAULT_REGISTER_PASSWORD,
  };
};

const goToLogin = async (page: Page) => {
  await page.goto('/login');
  await expect(page.getByTestId('login-username')).toBeVisible();
};

const goToRegister = async (page: Page) => {
  await page.goto('/register');
  await expect(page.getByTestId('register-username')).toBeVisible();
};

test.describe.serial('live backend auth', () => {
  const identity = createLiveIdentity();

  test('registers a fresh account through the live backend', async ({ page }) => {
    await goToRegister(page);
    await page.getByTestId('register-username').fill(identity.username);
    await page.getByTestId('register-email').fill(identity.email);
    await page.getByTestId('register-name').fill(identity.name);
    await page.getByTestId('register-password').fill(identity.password);
    await page.getByTestId('register-password-confirm').fill(identity.password);
    await page.getByTestId('register-submit').click();

    await expect(page).toHaveURL(/\/portfolio$/);
    await expect(page.getByTestId('protected-area-title')).toHaveText('Portfolio overview');
  });

  test('logs in with the live backend account created earlier', async ({ page }) => {
    await goToLogin(page);
    await page.getByTestId('login-username').fill(identity.email);
    await page.getByTestId('login-password').fill(identity.password);
    await page.getByTestId('login-submit').click();

    await expect(page).toHaveURL(/\/portfolio$/);
    await expect(page.getByTestId('protected-area-title')).toHaveText('Portfolio overview');
  });

  test('shows the canonical invalid credentials message for the registered live account', async ({
    page,
  }) => {
    await goToLogin(page);
    await page.getByTestId('login-username').fill(identity.email);
    await page.getByTestId('login-password').fill(process.env.LIVE_INVALID_PASSWORD ?? DEFAULT_INVALID_PASSWORD);
    await page.getByTestId('login-submit').click();

    await expect(page.getByTestId('error-message')).toHaveText(INVALID_CREDENTIALS_MESSAGE);
    await expect(page.getByTestId('login-submit')).toBeVisible();
  });
});
