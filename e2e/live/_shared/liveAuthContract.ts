import type { APIRequestContext, APIResponse } from '@playwright/test';

const LIVE_AUTH_HEALTH_TIMEOUT_MS = 30_000;
const LIVE_FORGOT_PREREQUISITE_PATH = '/api/v1/auth/password/forgot';

let liveAuthContractHealthcheck: Promise<void> | null = null;

const buildHealthFailureMessage = (responseStatus: number, responseStatusText: string, payload: string) => (
  `LIVE auth prerequisite is unhealthy. /api/v1/auth/csrf returned ${responseStatus} ${responseStatusText}`
  + (payload ? ` (${payload})` : '')
);

const buildForgotFailureMessage = (responseStatus: number, responseStatusText: string, payload: string) => (
  `LIVE auth prerequisite is unhealthy. ${LIVE_FORGOT_PREREQUISITE_PATH} returned ${responseStatus} ${responseStatusText}`
  + (payload ? ` (${payload})` : '')
);

const readResponsePayload = async (response: APIResponse) => {
  try {
    return await response.text();
  } catch {
    return '';
  }
};

const createForgotPreflightEmail = () =>
  `live-preflight-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}@example.com`;

const runLiveAuthContractHealthcheck = async (request: APIRequestContext) => {
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
  const csrfHeaderName = csrfPayload.data?.headerName ?? 'X-CSRF-TOKEN';

  if (!csrfToken) {
    throw new Error('LIVE auth prerequisite is unhealthy. /api/v1/auth/csrf did not return a csrfToken.');
  }

  let forgotResponse;

  try {
    forgotResponse = await request.post(LIVE_FORGOT_PREREQUISITE_PATH, {
      timeout: LIVE_AUTH_HEALTH_TIMEOUT_MS,
      headers: {
        'Content-Type': 'application/json',
        [csrfHeaderName]: csrfToken,
      },
      data: {
        email: createForgotPreflightEmail(),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `LIVE auth prerequisite is unreachable. ${LIVE_FORGOT_PREREQUISITE_PATH} failed within ${LIVE_AUTH_HEALTH_TIMEOUT_MS}ms (${message})`,
    );
  }

  if (!forgotResponse.ok()) {
    const payload = await readResponsePayload(forgotResponse);
    throw new Error(
      buildForgotFailureMessage(forgotResponse.status(), forgotResponse.statusText(), payload),
    );
  }

  const forgotPayload = await forgotResponse.json() as {
    success?: boolean;
    data?: {
      accepted?: boolean;
      recovery?: {
        challengeMayBeRequired?: boolean;
      };
    };
  };

  if (!forgotPayload.success || forgotPayload.data?.accepted !== true) {
    throw new Error(
      'LIVE auth prerequisite is unhealthy. /api/v1/auth/password/forgot did not return the accepted envelope.',
    );
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
