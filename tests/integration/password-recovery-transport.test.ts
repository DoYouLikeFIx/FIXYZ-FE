import type { AxiosAdapter, AxiosResponse } from 'axios';

import {
  parseRecoveryChallengeBootstrap,
  solveProofOfWorkChallenge,
} from '@/lib/recovery-challenge';

interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

interface MockHttpResponse {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
  statusText?: string;
}

const successEnvelope = <T,>(data: T): MockHttpResponse => ({
  status: 200,
  body: {
    success: true,
    data,
    error: null,
  },
});

const acceptedEnvelope = <T,>(data: T): MockHttpResponse => ({
  status: 202,
  body: {
    success: true,
    data,
    error: null,
  },
});

const normalizeHeaders = (headers: unknown): Record<string, string> => {
  if (!headers) {
    return {};
  }

  if (
    typeof headers === 'object'
    && headers !== null
    && 'toJSON' in headers
    && typeof (headers as { toJSON: () => Record<string, string> }).toJSON === 'function'
  ) {
    return (headers as { toJSON: () => Record<string, string> }).toJSON();
  }

  return {
    ...(headers as Record<string, string>),
  };
};

const normalizeBody = (body: unknown): string | undefined => {
  if (typeof body === 'string') {
    return body;
  }

  if (body instanceof URLSearchParams) {
    return body.toString();
  }

  return body === undefined || body === null
    ? undefined
    : JSON.stringify(body);
};

const getPathname = (url: string) => new URL(url, 'http://localhost').pathname;

const createAxiosHarness = async (
  handler: (request: RecordedCall) => Promise<MockHttpResponse> | MockHttpResponse,
) => {
  vi.resetModules();
  const actualAxios = await vi.importActual<typeof import('axios')>('axios');

  const calls: RecordedCall[] = [];

  const adapter: AxiosAdapter = async (config) => {
    const request: RecordedCall = {
      url: config.url ?? '/',
      method: (config.method ?? 'get').toUpperCase(),
      headers: normalizeHeaders(config.headers),
      body: normalizeBody(config.data),
    };

    calls.push(request);

    const response = await handler(request);
    const axiosResponse = {
      data: response.body,
      status: response.status,
      statusText: response.statusText ?? 'OK',
      headers: response.headers ?? {},
      config,
    } as AxiosResponse;

    if (response.status >= 400) {
      throw new actualAxios.AxiosError(
        `Request failed with status code ${response.status}`,
        'ERR_BAD_REQUEST',
        config,
        undefined,
        axiosResponse,
      );
    }

    return axiosResponse;
  };

  vi.doMock('axios', async () => ({
    ...actualAxios,
    default: {
      create: (config?: Record<string, unknown>) =>
        actualAxios.default.create({
          ...(config ?? {}),
          adapter,
        }),
      isAxiosError: actualAxios.default.isAxiosError,
    },
  }));

  const axiosLib = await import('@/lib/axios');
  const authApi = await import('@/api/authApi');

  axiosLib.clearCsrfToken();

  return {
    calls,
    requestPasswordRecoveryChallenge: authApi.requestPasswordRecoveryChallenge,
    requestPasswordResetEmail: authApi.requestPasswordResetEmail,
  };
};

describe.sequential('FE password recovery transport harness', () => {
  afterEach(() => {
    vi.doUnmock('axios');
    vi.restoreAllMocks();
  });

  it('bootstraps a proof-of-work recovery challenge through the FE transport and submits a solver-derived nonce with the original email', async () => {
    const issuedAtEpochMs = Date.now();
    const expiresAtEpochMs = issuedAtEpochMs + 300_000;
    const harness = await createAxiosHarness((request) => {
      if (request.method === 'GET' && getPathname(request.url) === '/api/v1/auth/csrf') {
        return successEnvelope({
          token: 'csrf-password-recovery',
        });
      }

      if (
        request.method === 'POST'
        && getPathname(request.url) === '/api/v1/auth/password/forgot/challenge'
      ) {
        return successEnvelope({
          challengeToken: 'challenge-token-v2',
          challengeType: 'proof-of-work',
          challengeTtlSeconds: 300,
          challengeContractVersion: 2,
          challengeId: 'challenge-id-v2',
          challengeIssuedAtEpochMs: issuedAtEpochMs,
          challengeExpiresAtEpochMs: expiresAtEpochMs,
          challengePayload: {
            kind: 'proof-of-work',
            proofOfWork: {
              algorithm: 'SHA-256',
              seed: 'seed-value',
              difficultyBits: 2,
              answerFormat: 'nonce-decimal',
              inputTemplate: '{seed}:{nonce}',
              inputEncoding: 'utf-8',
              successCondition: {
                type: 'leading-zero-bits',
                minimum: 2,
              },
            },
          },
        });
      }

      if (
        request.method === 'POST'
        && getPathname(request.url) === '/api/v1/auth/password/forgot'
      ) {
        return acceptedEnvelope({
          accepted: true,
          message: 'If the account is eligible, a reset email will be sent.',
          recovery: {
            challengeEndpoint: '/api/v1/auth/password/forgot/challenge',
            challengeMayBeRequired: true,
          },
        });
      }

      throw new Error(`Unhandled request: ${request.method} ${request.url}`);
    });

    const challenge = await harness.requestPasswordRecoveryChallenge({
      email: 'Demo+Tag@Fix.com',
    });

    expect(challenge).toMatchObject({
      challengeToken: 'challenge-token-v2',
      challengeType: 'proof-of-work',
      challengeContractVersion: 2,
      challengeId: 'challenge-id-v2',
    });

    const parsed = parseRecoveryChallengeBootstrap(challenge, issuedAtEpochMs);
    expect(parsed.kind).toBe('proof-of-work');
    if (parsed.kind !== 'proof-of-work') {
      throw new Error('expected a proof-of-work challenge');
    }

    const challengeAnswer = await solveProofOfWorkChallenge(
      parsed.challenge.challengePayload.proofOfWork,
    );

    await expect(
      harness.requestPasswordResetEmail({
        email: 'Demo+Tag@Fix.com',
        challengeToken: 'challenge-token-v2',
        challengeAnswer,
      }),
    ).resolves.toMatchObject({
      accepted: true,
      recovery: {
        challengeMayBeRequired: true,
      },
    });

    const bootstrapCall = harness.calls.find(
      (call) => getPathname(call.url) === '/api/v1/auth/password/forgot/challenge',
    );
    const forgotCall = harness.calls.find(
      (call) => getPathname(call.url) === '/api/v1/auth/password/forgot',
    );

    expect(bootstrapCall?.body).toContain('Demo+Tag@Fix.com');
    expect(forgotCall?.body).toContain('Demo+Tag@Fix.com');
    expect(forgotCall?.body).toContain('challenge-token-v2');
    expect(forgotCall?.body).toContain(challengeAnswer);
  });
});
