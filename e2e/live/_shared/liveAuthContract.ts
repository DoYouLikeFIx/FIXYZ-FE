import type { APIRequestContext, APIResponse, Page } from '@playwright/test';

const LIVE_AUTH_HEALTH_TIMEOUT_MS = 30_000;
const LIVE_AUTH_HEALTH_BASE_URL = (
  process.env.LIVE_API_BASE_URL?.trim()
  || process.env.VITE_DEV_PROXY_TARGET?.trim()
  || ''
).replace(/\/$/, '');

let liveAuthContractHealthcheck: Promise<void> | null = null;

const resolveLiveAuthUrl = (path: string) =>
  LIVE_AUTH_HEALTH_BASE_URL ? `${LIVE_AUTH_HEALTH_BASE_URL}${path}` : path;

const buildHealthFailureMessage = (responseStatus: number, responseStatusText: string, payload: string) => (
  `LIVE auth prerequisite is unhealthy. /api/v1/auth/csrf returned ${responseStatus} ${responseStatusText}`
  + (payload ? ` (${payload})` : '')
);

const readResponsePayload = async (response: APIResponse) => {
  try {
    return await response.text();
  } catch {
    return '';
  }
};

const runLiveAuthContractHealthcheck = async (request: APIRequestContext) => {
  let response;

  try {
    response = await request.get(resolveLiveAuthUrl('/api/v1/auth/csrf'), {
      timeout: LIVE_AUTH_HEALTH_TIMEOUT_MS,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `LIVE auth prerequisite is unreachable. /api/v1/auth/csrf failed within ${LIVE_AUTH_HEALTH_TIMEOUT_MS}ms (${message})`,
    );
  }

  if (!response.ok()) {
    const payload = await readResponsePayload(response);
    throw new Error(
      buildHealthFailureMessage(response.status(), response.statusText(), payload),
    );
  }

  const csrfPayload = await response.json() as {
    data?: {
      token?: string;
      csrfToken?: string;
      headerName?: string;
    };
  };
  const csrfToken = csrfPayload.data?.csrfToken ?? csrfPayload.data?.token;

  if (!csrfToken) {
    throw new Error('LIVE auth prerequisite is unhealthy. /api/v1/auth/csrf did not return a csrfToken.');
  }
};

export const requireLiveAuthContractHealthy = async (request: APIRequestContext) => {
  if (!liveAuthContractHealthcheck) {
    liveAuthContractHealthcheck = runLiveAuthContractHealthcheck(request).catch((error) => {
      liveAuthContractHealthcheck = null;
      throw error;
    });
  }

  await liveAuthContractHealthcheck;
};

const readBrowserCsrfPayload = async (page: Page) => page.evaluate(async () => {
  const response = await fetch('/api/v1/auth/csrf', {
    credentials: 'include',
  });

  if (!response.ok) {
    throw new Error(`/api/v1/auth/csrf returned ${response.status} ${response.statusText}`);
  }

  const payload = await response.json() as {
    success?: boolean;
    data?: {
      csrfToken?: string;
      token?: string;
    };
  };
  const csrfToken = payload.data?.csrfToken ?? payload.data?.token;

  if (!payload.success || !csrfToken) {
    throw new Error('/api/v1/auth/csrf did not return a csrfToken.');
  }

  return csrfToken;
});

export const primeLiveBrowserCsrf = async (page: Page) => {
  const pageUrl = page.url();

  if (!pageUrl || pageUrl === 'about:blank') {
    throw new Error('primeLiveBrowserCsrf requires an already loaded live page.');
  }

  const pageOrigin = new URL(pageUrl).origin;
  const response = await page.context().request.get(`${pageOrigin}/api/v1/auth/csrf`, {
    timeout: LIVE_AUTH_HEALTH_TIMEOUT_MS,
    failOnStatusCode: false,
  });

  if (!response.ok()) {
    const payload = await readResponsePayload(response);
    throw new Error(buildHealthFailureMessage(response.status(), response.statusText(), payload));
  }

  await readBrowserCsrfPayload(page);
};
