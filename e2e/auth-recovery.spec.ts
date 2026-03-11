import { expect, test } from '@playwright/test';

const installAnonymousSession = async (page: import('@playwright/test').Page) => {
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
};

test.describe('password recovery auth flow', () => {
  test('navigates to forgot-password, bootstraps a challenge, and returns to login after reset success', async ({
    page,
  }) => {
    await installAnonymousSession(page);

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

    await page.goto('/login');
    await page.getByTestId('login-email').fill('demo@fix.com');
    await page.getByTestId('login-open-password-recovery').click();

    await expect(page).toHaveURL(/\/forgot-password/);
    await expect(page.getByTestId('forgot-password-email')).toHaveValue('demo@fix.com');

    await page.getByTestId('forgot-password-submit').click();
    await expect(page.getByTestId('forgot-password-accepted')).toContainText(
      'If the account is eligible, a reset email will be sent.',
    );

    await page.getByTestId('forgot-password-bootstrap-challenge').click();
    await expect(page.getByTestId('forgot-password-challenge-state')).toContainText('captcha');
    await page.getByTestId('forgot-password-challenge-answer').fill('ready');
    await page.getByTestId('forgot-password-submit').click();

    await page.goto('/reset-password?token=reset-token');
    await page.getByTestId('reset-password-new-password').fill('Test1234!');
    await page.getByTestId('reset-password-submit').click();

    await expect(page).toHaveURL(/\/login\?recovery=reset-success/);
    await expect(page.getByTestId('password-reset-success')).toContainText(
      '비밀번호가 변경되었습니다. 새 비밀번호로 로그인해 주세요.',
    );
  });

  test('routes reset AUTH-016 failures back to login with re-auth guidance', async ({
    page,
  }) => {
    await installAnonymousSession(page);

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

    await page.route('**/api/v1/auth/password/reset', async (route) => {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({
          success: false,
          data: null,
          error: {
            code: 'AUTH-016',
            message: 'Session invalidated by another login',
            detail: 'The recovery flow must restart from login.',
            timestamp: '2026-03-10T00:00:00.000Z',
          },
        }),
      });
    });

    await page.goto('/reset-password?token=stale-reset-token');
    await page.getByTestId('reset-password-new-password').fill('Test1234!');
    await page.getByTestId('reset-password-submit').click();

    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByTestId('reauth-guidance')).toContainText(
      '세션이 만료되었습니다. 다시 로그인해 주세요.',
    );
  });

  test('retries forgot-password once after a csrf 403 and then shows terminal guidance on the second 403', async ({
    page,
  }) => {
    await installAnonymousSession(page);

    let csrfFetches = 0;
    let forgotAttempts = 0;

    await page.route('**/api/v1/auth/csrf', async (route) => {
      csrfFetches += 1;

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            csrfToken: `csrf-token-${csrfFetches}`,
            headerName: 'X-CSRF-TOKEN',
          },
          error: null,
        }),
      });
    });

    await page.route('**/api/v1/auth/password/forgot', async (route) => {
      forgotAttempts += 1;

      await route.fulfill({
        status: 403,
        contentType: 'text/plain',
        body: 'Forbidden',
      });
    });

    await page.goto('/forgot-password');
    await page.getByTestId('forgot-password-email').fill('demo@fix.com');
    await page.getByTestId('forgot-password-submit').click();

    await expect(page.getByTestId('forgot-password-error')).toContainText(
      '요청을 확인할 수 없습니다. 페이지를 새로고침한 뒤 다시 시도해 주세요.',
    );
    await expect(page.getByTestId('forgot-password-submit')).toBeVisible();
    expect(forgotAttempts).toBe(2);
    expect(csrfFetches).toBe(2);
  });

  test('retries challenge bootstrap once after a csrf 403 and then shows terminal guidance on the second 403', async ({
    page,
  }) => {
    await installAnonymousSession(page);

    let csrfFetches = 0;
    let challengeAttempts = 0;

    await page.route('**/api/v1/auth/csrf', async (route) => {
      csrfFetches += 1;

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            csrfToken: `csrf-token-${csrfFetches}`,
            headerName: 'X-CSRF-TOKEN',
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

    await page.route('**/api/v1/auth/password/forgot/challenge', async (route) => {
      challengeAttempts += 1;

      await route.fulfill({
        status: 403,
        contentType: 'text/plain',
        body: 'Forbidden',
      });
    });

    await page.goto('/forgot-password');
    await page.getByTestId('forgot-password-email').fill('demo@fix.com');
    await page.getByTestId('forgot-password-submit').click();
    await page.getByTestId('forgot-password-bootstrap-challenge').click();

    await expect(page.getByTestId('forgot-password-error')).toContainText(
      '요청을 확인할 수 없습니다. 페이지를 새로고침한 뒤 다시 시도해 주세요.',
    );
    expect(challengeAttempts).toBe(2);
    expect(csrfFetches).toBe(2);
  });

  test('retries reset submit once after a csrf 403 and then shows terminal guidance on the second 403', async ({
    page,
  }) => {
    await installAnonymousSession(page);

    let csrfFetches = 0;
    let resetAttempts = 0;

    await page.route('**/api/v1/auth/csrf', async (route) => {
      csrfFetches += 1;

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            csrfToken: `csrf-token-${csrfFetches}`,
            headerName: 'X-CSRF-TOKEN',
          },
          error: null,
        }),
      });
    });

    await page.route('**/api/v1/auth/password/reset', async (route) => {
      resetAttempts += 1;

      await route.fulfill({
        status: 403,
        contentType: 'text/plain',
        body: 'Forbidden',
      });
    });

    await page.goto('/reset-password?token=reset-token');
    await page.getByTestId('reset-password-new-password').fill('Test1234!');
    await page.getByTestId('reset-password-submit').click();

    await expect(page.getByTestId('reset-password-error')).toContainText(
      '요청을 확인할 수 없습니다. 페이지를 새로고침한 뒤 다시 시도해 주세요.',
    );
    expect(resetAttempts).toBe(2);
    expect(csrfFetches).toBe(2);
  });
});
