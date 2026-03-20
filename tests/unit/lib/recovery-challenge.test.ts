import {
  RECOVERY_CHALLENGE_FAIL_CLOSED_EVENT,
  parseRecoveryChallengeBootstrap,
  reportRecoveryChallengeFailClosed,
  recoveryChallengeFailClosedMessage,
  selectRecoveryChallengeSession,
  type RecoveryChallengeSession,
} from '@/lib/recovery-challenge';

describe('recovery challenge parsing', () => {
  it('keeps the exact legacy bootstrap shape intact', () => {
    expect(
      parseRecoveryChallengeBootstrap({
        challengeToken: 'challenge-token',
        challengeType: 'captcha',
        challengeTtlSeconds: 300,
      }),
    ).toEqual({
      kind: 'legacy',
      challenge: {
        challengeToken: 'challenge-token',
        challengeType: 'captcha',
        challengeTtlSeconds: 300,
      },
    });
  });

  it('parses the proof-of-work v2 contract and preserves the canonical payload fields', () => {
    expect(
      parseRecoveryChallengeBootstrap({
        challengeToken: 'challenge-token-v2',
        challengeType: 'proof-of-work',
        challengeTtlSeconds: 300,
        challengeContractVersion: 2,
        challengeId: 'challenge-id-v2',
        challengeIssuedAtEpochMs: 1710000000000,
        challengeExpiresAtEpochMs: 1710000300000,
        challengePayload: {
          kind: 'proof-of-work',
          proofOfWork: {
            algorithm: 'SHA-256',
            seed: 'seed-value',
            difficultyBits: 1,
            answerFormat: 'nonce-decimal',
            inputTemplate: '{seed}:{nonce}',
            inputEncoding: 'utf-8',
            successCondition: {
              type: 'leading-zero-bits',
              minimum: 1,
            },
          },
        },
      }, 1710000000000),
    ).toEqual({
      kind: 'proof-of-work',
      challenge: {
        challengeToken: 'challenge-token-v2',
        challengeType: 'proof-of-work',
        challengeTtlSeconds: 300,
        challengeContractVersion: 2,
        challengeId: 'challenge-id-v2',
        challengeIssuedAtEpochMs: 1710000000000,
        challengeExpiresAtEpochMs: 1710000300000,
        challengePayload: {
          kind: 'proof-of-work',
          proofOfWork: {
            algorithm: 'SHA-256',
            seed: 'seed-value',
            difficultyBits: 1,
            answerFormat: 'nonce-decimal',
            inputTemplate: '{seed}:{nonce}',
            inputEncoding: 'utf-8',
            successCondition: {
              type: 'leading-zero-bits',
              minimum: 1,
            },
          },
        },
      },
    });
  });

  it('fails closed on mixed legacy and v2 challenge shapes', () => {
    expect(
      parseRecoveryChallengeBootstrap({
        challengeToken: 'challenge-token',
        challengeType: 'captcha',
        challengeTtlSeconds: 300,
        challengeId: 'challenge-id-v2',
      }),
    ).toEqual({
      kind: 'fail-closed',
      reason: 'mixed-shape',
      message: recoveryChallengeFailClosedMessage('mixed-shape'),
    });
  });

  it('fails closed on version-2 bundles that still carry a legacy discriminator', () => {
    expect(
      parseRecoveryChallengeBootstrap({
        challengeToken: 'challenge-token-v2',
        challengeType: 'captcha',
        challengeTtlSeconds: 300,
        challengeContractVersion: 2,
        challengeId: 'challenge-id-v2',
        challengeIssuedAtEpochMs: 1710000000000,
        challengeExpiresAtEpochMs: 1710000300000,
        challengePayload: {
          kind: 'proof-of-work',
          proofOfWork: {
            algorithm: 'SHA-256',
            seed: 'seed-value',
            difficultyBits: 1,
            answerFormat: 'nonce-decimal',
            inputTemplate: '{seed}:{nonce}',
            inputEncoding: 'utf-8',
            successCondition: {
              type: 'leading-zero-bits',
              minimum: 1,
            },
          },
        },
      }),
    ).toEqual({
      kind: 'fail-closed',
      reason: 'kind-mismatch',
      message: recoveryChallengeFailClosedMessage('kind-mismatch'),
      challengeIssuedAtEpochMs: 1710000000000,
    });
  });

  it('fails closed on unsupported contract versions', () => {
    expect(
      parseRecoveryChallengeBootstrap({
        challengeToken: 'challenge-token-v2',
        challengeType: 'proof-of-work',
        challengeTtlSeconds: 300,
        challengeContractVersion: 3,
        challengeId: 'challenge-id-v2',
        challengeIssuedAtEpochMs: 1710000000000,
        challengeExpiresAtEpochMs: 1710000300000,
        challengePayload: {
          kind: 'proof-of-work',
          proofOfWork: {
            algorithm: 'SHA-256',
            seed: 'seed-value',
            difficultyBits: 1,
            answerFormat: 'nonce-decimal',
            inputTemplate: '{seed}:{nonce}',
            inputEncoding: 'utf-8',
            successCondition: {
              type: 'leading-zero-bits',
              minimum: 1,
            },
          },
        },
      }),
    ).toEqual({
      kind: 'fail-closed',
      reason: 'unknown-version',
      message: recoveryChallengeFailClosedMessage('unknown-version'),
      challengeIssuedAtEpochMs: 1710000000000,
    });
  });

  it('fails closed when the receipt time differs from the authoritative issue time by more than 30 seconds', () => {
    expect(
      parseRecoveryChallengeBootstrap(
        {
          challengeToken: 'challenge-token-v2',
          challengeType: 'proof-of-work',
          challengeTtlSeconds: 300,
          challengeContractVersion: 2,
          challengeId: 'challenge-id-v2',
          challengeIssuedAtEpochMs: 1710000000000,
          challengeExpiresAtEpochMs: 1710000300000,
          challengePayload: {
            kind: 'proof-of-work',
            proofOfWork: {
              algorithm: 'SHA-256',
              seed: 'seed-value',
              difficultyBits: 1,
              answerFormat: 'nonce-decimal',
              inputTemplate: '{seed}:{nonce}',
              inputEncoding: 'utf-8',
              successCondition: {
                type: 'leading-zero-bits',
                minimum: 1,
              },
            },
          },
        },
        1710000040001,
      ),
    ).toEqual({
      kind: 'fail-closed',
      reason: 'clock-skew',
      message: recoveryChallengeFailClosedMessage('clock-skew'),
      challengeIssuedAtEpochMs: 1710000000000,
    });
  });

  it('fails closed when the challenge enters the expiry safety window', () => {
    expect(
      parseRecoveryChallengeBootstrap(
        {
          challengeToken: 'challenge-token-v2',
          challengeType: 'proof-of-work',
          challengeTtlSeconds: 300,
          challengeContractVersion: 2,
          challengeId: 'challenge-id-v2',
          challengeIssuedAtEpochMs: 1710000000000,
          challengeExpiresAtEpochMs: 1710000004000,
          challengePayload: {
            kind: 'proof-of-work',
            proofOfWork: {
              algorithm: 'SHA-256',
              seed: 'seed-value',
              difficultyBits: 1,
              answerFormat: 'nonce-decimal',
              inputTemplate: '{seed}:{nonce}',
              inputEncoding: 'utf-8',
              successCondition: {
                type: 'leading-zero-bits',
                minimum: 1,
              },
            },
          },
        },
        1710000000000,
      ),
    ).toEqual({
      kind: 'fail-closed',
      reason: 'validity-untrusted',
      message: recoveryChallengeFailClosedMessage('validity-untrusted'),
      challengeIssuedAtEpochMs: 1710000000000,
    });
  });

  it('treats equal issue timestamps from a different challenge id as fail closed', () => {
    const currentChallenge: RecoveryChallengeSession = {
      kind: 'proof-of-work',
      email: 'demo@fix.com',
      receivedAtEpochMs: 1710000001000,
      challengeToken: 'challenge-token-v2',
      challengeType: 'proof-of-work',
      challengeTtlSeconds: 300,
      challengeContractVersion: 2,
      challengeId: 'challenge-id-v1',
      challengeIssuedAtEpochMs: 1710000000000,
      challengeExpiresAtEpochMs: 1710000300000,
      challengePayload: {
        kind: 'proof-of-work',
        proofOfWork: {
          algorithm: 'SHA-256',
          seed: 'seed-value',
          difficultyBits: 1,
          answerFormat: 'nonce-decimal',
          inputTemplate: '{seed}:{nonce}',
          inputEncoding: 'utf-8',
          successCondition: {
            type: 'leading-zero-bits',
            minimum: 1,
          },
        },
      },
      solveStatus: 'idle',
    };

    expect(
      selectRecoveryChallengeSession(currentChallenge, {
        kind: 'proof-of-work',
        email: 'demo@fix.com',
        receivedAtEpochMs: 1710000002000,
        challengeToken: 'challenge-token-v2-b',
        challengeType: 'proof-of-work',
        challengeTtlSeconds: 300,
        challengeContractVersion: 2,
        challengeId: 'challenge-id-v2',
        challengeIssuedAtEpochMs: 1710000000000,
        challengeExpiresAtEpochMs: 1710000300000,
        challengePayload: {
          kind: 'proof-of-work',
          proofOfWork: {
            algorithm: 'SHA-256',
            seed: 'seed-value',
            difficultyBits: 1,
            answerFormat: 'nonce-decimal',
            inputTemplate: '{seed}:{nonce}',
            inputEncoding: 'utf-8',
            successCondition: {
              type: 'leading-zero-bits',
              minimum: 1,
            },
          },
        },
        solveStatus: 'idle',
      }),
    ).toEqual({
      kind: 'fail-closed',
      reason: 'validity-untrusted',
      message: recoveryChallengeFailClosedMessage('validity-untrusted'),
      challengeIssuedAtEpochMs: 1710000000000,
    });
  });

  it('reports fail-closed reasons to the auth telemetry stream', () => {
    const sink = vi.fn();
    const payloads: Array<{ reason: string; surface: string }> = [];
    const listener = (event: Event) => {
      payloads.push(
        (event as CustomEvent<{ reason: string; surface: string }>).detail,
      );
    };

    (
      globalThis as typeof globalThis & {
        __FIXYZ_AUTH_TELEMETRY__?: (event: unknown) => void;
      }
    ).__FIXYZ_AUTH_TELEMETRY__ = sink;
    window.addEventListener(RECOVERY_CHALLENGE_FAIL_CLOSED_EVENT, listener as EventListener);

    try {
      reportRecoveryChallengeFailClosed('unknown-version');

      expect(payloads).toEqual([
        {
          reason: 'unknown-version',
          surface: 'forgot-password-web',
        },
      ]);
      expect(sink).toHaveBeenCalledWith({
        name: RECOVERY_CHALLENGE_FAIL_CLOSED_EVENT,
        payload: {
          reason: 'unknown-version',
          surface: 'forgot-password-web',
        },
      });
    } finally {
      window.removeEventListener(RECOVERY_CHALLENGE_FAIL_CLOSED_EVENT, listener as EventListener);
      delete (
        globalThis as typeof globalThis & {
          __FIXYZ_AUTH_TELEMETRY__?: (event: unknown) => void;
        }
      ).__FIXYZ_AUTH_TELEMETRY__;
    }
  });
});
