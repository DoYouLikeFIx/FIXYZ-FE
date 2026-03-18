import { test, type APIRequestContext } from '@playwright/test';

const buildSkipMessage = (responseStatus: number, responseStatusText: string, payload: string) => (
  `LIVE auth prerequisite is unhealthy. /api/v1/auth/csrf returned ${responseStatus} ${responseStatusText}`
  + (payload ? ` (${payload})` : '')
);

export const requireLiveAuthContractHealthy = async (request: APIRequestContext) => {
  const response = await request.get('/api/v1/auth/csrf');

  if (response.ok()) {
    return;
  }

  const payload = await response.text();
  test.skip(true, buildSkipMessage(response.status(), response.statusText(), payload));
};
