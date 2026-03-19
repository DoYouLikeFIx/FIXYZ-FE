import type { APIRequestContext } from '@playwright/test';

const LIVE_AUTH_HEALTH_TIMEOUT_MS = 5_000;

const buildHealthFailureMessage = (responseStatus: number, responseStatusText: string, payload: string) => (
  `LIVE auth prerequisite is unhealthy. /api/v1/auth/csrf returned ${responseStatus} ${responseStatusText}`
  + (payload ? ` (${payload})` : '')
);

export const requireLiveAuthContractHealthy = async (request: APIRequestContext) => {
  let response;

  try {
    response = await request.get('/api/v1/auth/csrf', {
      timeout: LIVE_AUTH_HEALTH_TIMEOUT_MS,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `LIVE auth prerequisite is unreachable. /api/v1/auth/csrf failed within ${LIVE_AUTH_HEALTH_TIMEOUT_MS}ms (${message})`,
    );
  }

  if (response.ok()) {
    return;
  }

  const payload = await response.text();
  throw new Error(
    buildHealthFailureMessage(response.status(), response.statusText(), payload),
  );
};
