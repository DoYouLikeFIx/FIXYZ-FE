import type {
  PasswordRecoveryChallengeLegacyResponse,
  PasswordRecoveryChallengeProofOfWorkPayload,
  PasswordRecoveryChallengeV2Response,
} from '@/types/auth';

export type RecoveryChallengeFailClosedReason =
  | 'unknown-version'
  | 'kind-mismatch'
  | 'malformed-payload'
  | 'mixed-shape'
  | 'clock-skew'
  | 'validity-untrusted';

export interface RecoveryChallengeLegacySession
  extends PasswordRecoveryChallengeLegacyResponse {
  kind: 'legacy';
  email: string;
  receivedAtEpochMs: number;
}

export interface RecoveryChallengeProofOfWorkSession
  extends PasswordRecoveryChallengeV2Response {
  kind: 'proof-of-work';
  email: string;
  receivedAtEpochMs: number;
  challengeAnswer?: string;
  solveStatus: 'idle' | 'solving' | 'solved';
}

export type RecoveryChallengeSession =
  | RecoveryChallengeLegacySession
  | RecoveryChallengeProofOfWorkSession;

export type ParsedRecoveryChallengeBootstrap =
  | {
      kind: 'legacy';
      challenge: PasswordRecoveryChallengeLegacyResponse;
    }
  | {
      kind: 'proof-of-work';
      challenge: PasswordRecoveryChallengeV2Response;
    }
  | {
      kind: 'fail-closed';
      reason: RecoveryChallengeFailClosedReason;
      message: string;
    };

export type RecoveryChallengeSelection =
  | {
      kind: 'accepted';
      challenge: RecoveryChallengeSession;
    }
  | {
      kind: 'stale';
    }
  | {
      kind: 'fail-closed';
      reason: RecoveryChallengeFailClosedReason;
      message: string;
    };

const LEGACY_KEYS = ['challengeToken', 'challengeType', 'challengeTtlSeconds'] as const;
const V2_KEYS = [
  'challengeToken',
  'challengeType',
  'challengeTtlSeconds',
  'challengeContractVersion',
  'challengeId',
  'challengeIssuedAtEpochMs',
  'challengeExpiresAtEpochMs',
  'challengePayload',
] as const;
const PROOF_OF_WORK_KEYS = [
  'kind',
  'proofOfWork',
] as const;
const PROOF_OF_WORK_DETAIL_KEYS = [
  'algorithm',
  'seed',
  'difficultyBits',
  'answerFormat',
  'inputTemplate',
  'inputEncoding',
  'successCondition',
] as const;
const PROOF_OF_WORK_SUCCESS_CONDITION_KEYS = ['type', 'minimum'] as const;
const CLOCK_SKEW_THRESHOLD_MS = 30_000;
const EXPIRY_SAFETY_MARGIN_MS = 5_000;

const FAIL_CLOSED_MESSAGES: Record<RecoveryChallengeFailClosedReason, string> = {
  'unknown-version': '보안 확인 정보를 새로 불러와 다시 진행해 주세요.',
  'kind-mismatch': '보안 확인 정보를 새로 불러와 다시 진행해 주세요.',
  'malformed-payload': '보안 확인 정보를 새로 불러와 다시 진행해 주세요.',
  'mixed-shape': '보안 확인 정보를 새로 불러와 다시 진행해 주세요.',
  'clock-skew': '기기 시간 차이로 보안 확인을 이어갈 수 없습니다. 보안 확인을 새로 불러와 주세요.',
  'validity-untrusted': '보안 확인 유효성을 다시 확인할 수 없어 새 보안 확인이 필요합니다.',
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const hasExactKeys = (value: Record<string, unknown>, keys: readonly string[]) => {
  const actualKeys = Object.keys(value);
  return actualKeys.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
};

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const isPositiveInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value > 0;

const isNonNegativeInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0;

const cloneLegacyChallenge = (
  value: Record<string, unknown>,
): PasswordRecoveryChallengeLegacyResponse | null => {
  if (!hasExactKeys(value, LEGACY_KEYS)) {
    return null;
  }

  const { challengeToken, challengeType, challengeTtlSeconds } = value;

  if (!isNonEmptyString(challengeToken) || !isNonEmptyString(challengeType) || !isPositiveInteger(challengeTtlSeconds)) {
    return null;
  }

  return {
    challengeToken,
    challengeType,
    challengeTtlSeconds,
  };
};

const cloneProofOfWorkPayload = (
  value: unknown,
): PasswordRecoveryChallengeProofOfWorkPayload | null => {
  if (!isRecord(value) || !hasExactKeys(value, PROOF_OF_WORK_KEYS)) {
    return null;
  }

  if (value.kind !== 'proof-of-work' || !isRecord(value.proofOfWork) || !hasExactKeys(value.proofOfWork, PROOF_OF_WORK_DETAIL_KEYS)) {
    return null;
  }

  const proofOfWork = value.proofOfWork;
  const { algorithm, seed, difficultyBits, answerFormat, inputTemplate, inputEncoding, successCondition } = proofOfWork;

  if (
    algorithm !== 'SHA-256' ||
    !isNonEmptyString(seed) ||
    !isPositiveInteger(difficultyBits) ||
    answerFormat !== 'nonce-decimal' ||
    inputTemplate !== '{seed}:{nonce}' ||
    inputEncoding !== 'utf-8' ||
    !isRecord(successCondition) ||
    !hasExactKeys(successCondition, PROOF_OF_WORK_SUCCESS_CONDITION_KEYS) ||
    successCondition.type !== 'leading-zero-bits' ||
    successCondition.minimum !== difficultyBits
  ) {
    return null;
  }

  return {
    kind: 'proof-of-work',
    proofOfWork: {
      algorithm,
      seed,
      difficultyBits,
      answerFormat,
      inputTemplate,
      inputEncoding,
      successCondition: {
        type: successCondition.type,
        minimum: successCondition.minimum,
      },
    },
  };
};

const cloneProofOfWorkChallenge = (
  value: Record<string, unknown>,
): PasswordRecoveryChallengeV2Response | null => {
  if (!hasExactKeys(value, V2_KEYS)) {
    return null;
  }

  const {
    challengeToken,
    challengeType,
    challengeTtlSeconds,
    challengeContractVersion,
    challengeId,
    challengeIssuedAtEpochMs,
    challengeExpiresAtEpochMs,
    challengePayload,
  } = value;

  const payload = cloneProofOfWorkPayload(challengePayload);

  if (
    challengeContractVersion !== 2 ||
    !isNonEmptyString(challengeToken) ||
    challengeType !== 'proof-of-work' ||
    !isPositiveInteger(challengeTtlSeconds) ||
    !isNonEmptyString(challengeId) ||
    !isNonNegativeInteger(challengeIssuedAtEpochMs) ||
    !isPositiveInteger(challengeExpiresAtEpochMs) ||
    challengeExpiresAtEpochMs <= challengeIssuedAtEpochMs ||
    payload === null
  ) {
    return null;
  }

  return {
    challengeToken,
    challengeType: 'proof-of-work',
    challengeTtlSeconds,
    challengeContractVersion: 2,
    challengeId,
    challengeIssuedAtEpochMs,
    challengeExpiresAtEpochMs,
    challengePayload: payload,
  };
};

export const recoveryChallengeFailClosedMessage = (
  reason: RecoveryChallengeFailClosedReason,
) => FAIL_CLOSED_MESSAGES[reason];

export const RECOVERY_CHALLENGE_FAIL_CLOSED_EVENT = 'password-recovery-challenge-fail-closed';

type RecoveryChallengeFailClosedTelemetryEvent = {
  name: typeof RECOVERY_CHALLENGE_FAIL_CLOSED_EVENT;
  payload: {
    reason: RecoveryChallengeFailClosedReason;
    surface: 'forgot-password-web';
  };
};

type RecoveryChallengeFailClosedTelemetrySink = (
  event: RecoveryChallengeFailClosedTelemetryEvent,
) => void;

const defaultRecoveryChallengeFailClosedTelemetrySink: RecoveryChallengeFailClosedTelemetrySink = (
  event,
) => {
  if (typeof console !== 'undefined' && typeof console.warn === 'function') {
    console.warn('password recovery challenge fail-closed', event.payload);
  }
};

export const reportRecoveryChallengeFailClosed = (
  reason: RecoveryChallengeFailClosedReason,
) => {
  const telemetryEvent: RecoveryChallengeFailClosedTelemetryEvent = {
    name: RECOVERY_CHALLENGE_FAIL_CLOSED_EVENT,
    payload: {
      reason,
      surface: 'forgot-password-web',
    },
  };

  if (
    typeof window !== 'undefined'
    && typeof window.dispatchEvent === 'function'
    && typeof CustomEvent === 'function'
  ) {
    window.dispatchEvent(
      new CustomEvent(RECOVERY_CHALLENGE_FAIL_CLOSED_EVENT, {
        detail: telemetryEvent.payload,
      }),
    );
  }

  try {
    defaultRecoveryChallengeFailClosedTelemetrySink(telemetryEvent);
  } catch {
    // Telemetry must never break the recovery flow.
  }

  (
    globalThis as typeof globalThis & {
      __FIXYZ_AUTH_TELEMETRY__?: RecoveryChallengeFailClosedTelemetrySink;
    }
  ).__FIXYZ_AUTH_TELEMETRY__?.(telemetryEvent);
};

export const parseRecoveryChallengeBootstrap = (
  value: unknown,
  receivedAtEpochMs = Date.now(),
): ParsedRecoveryChallengeBootstrap => {
  if (!isRecord(value)) {
    return {
      kind: 'fail-closed',
      reason: 'malformed-payload',
      message: recoveryChallengeFailClosedMessage('malformed-payload'),
    };
  }

  const legacyChallenge = cloneLegacyChallenge(value);
  if (legacyChallenge !== null) {
    return {
      kind: 'legacy',
      challenge: legacyChallenge,
    };
  }

  if (Object.hasOwn(value, 'challengeContractVersion')) {
    const version = value.challengeContractVersion;

    if (version !== 2) {
      return {
        kind: 'fail-closed',
        reason: 'unknown-version',
        message: recoveryChallengeFailClosedMessage('unknown-version'),
      };
    }

    const payloadCandidate = isRecord(value.challengePayload) ? value.challengePayload : null;

    if (
      payloadCandidate &&
      isNonEmptyString(payloadCandidate.kind) &&
      payloadCandidate.kind !== 'proof-of-work'
    ) {
      return {
        kind: 'fail-closed',
        reason: 'kind-mismatch',
        message: recoveryChallengeFailClosedMessage('kind-mismatch'),
      };
    }

    if (
      value.challengeType !== 'proof-of-work' &&
      payloadCandidate &&
      payloadCandidate.kind === 'proof-of-work'
    ) {
      return {
        kind: 'fail-closed',
        reason: 'kind-mismatch',
        message: recoveryChallengeFailClosedMessage('kind-mismatch'),
      };
    }

    if (value.challengeType !== 'proof-of-work') {
      return {
        kind: 'fail-closed',
        reason: 'mixed-shape',
        message: recoveryChallengeFailClosedMessage('mixed-shape'),
      };
    }

    const challenge = cloneProofOfWorkChallenge(value);

    if (challenge === null) {
      return {
        kind: 'fail-closed',
        reason: 'malformed-payload',
        message: recoveryChallengeFailClosedMessage('malformed-payload'),
      };
    }

    const skewMs = Math.abs(receivedAtEpochMs - challenge.challengeIssuedAtEpochMs);
    const remainingMs = challenge.challengeExpiresAtEpochMs - receivedAtEpochMs;

    if (skewMs > CLOCK_SKEW_THRESHOLD_MS) {
      return {
        kind: 'fail-closed',
        reason: 'clock-skew',
        message: recoveryChallengeFailClosedMessage('clock-skew'),
      };
    }

    if (remainingMs <= EXPIRY_SAFETY_MARGIN_MS) {
      return {
        kind: 'fail-closed',
        reason: 'validity-untrusted',
        message: recoveryChallengeFailClosedMessage('validity-untrusted'),
      };
    }

    return {
      kind: 'proof-of-work',
      challenge,
    };
  }

  if (
    Object.hasOwn(value, 'challengeId') ||
    Object.hasOwn(value, 'challengeIssuedAtEpochMs') ||
    Object.hasOwn(value, 'challengeExpiresAtEpochMs') ||
    Object.hasOwn(value, 'challengePayload')
  ) {
    return {
      kind: 'fail-closed',
      reason: 'mixed-shape',
      message: recoveryChallengeFailClosedMessage('mixed-shape'),
    };
  }

  return {
    kind: 'fail-closed',
    reason: 'malformed-payload',
    message: recoveryChallengeFailClosedMessage('malformed-payload'),
  };
};

export const selectRecoveryChallengeSession = (
  current: RecoveryChallengeSession | null,
  next: RecoveryChallengeSession,
): RecoveryChallengeSelection => {
  if (next.kind === 'legacy') {
    return {
      kind: 'accepted',
      challenge: next,
    };
  }

  if (current === null || current.kind === 'legacy') {
    return {
      kind: 'accepted',
      challenge: next,
    };
  }

  if (next.challengeId === current.challengeId && next.challengeIssuedAtEpochMs === current.challengeIssuedAtEpochMs) {
    return {
      kind: 'accepted',
      challenge: next,
    };
  }

  if (next.challengeIssuedAtEpochMs > current.challengeIssuedAtEpochMs) {
    return {
      kind: 'accepted',
      challenge: next,
    };
  }

  if (next.challengeIssuedAtEpochMs < current.challengeIssuedAtEpochMs) {
    return {
      kind: 'stale',
    };
  }

  return {
    kind: 'fail-closed',
    reason: 'validity-untrusted',
    message: recoveryChallengeFailClosedMessage('validity-untrusted'),
  };
};

const hasLeadingZeroBits = (digest: Uint8Array, difficultyBits: number) => {
  const fullZeroBytes = Math.floor(difficultyBits / 8);
  const remainingBits = difficultyBits % 8;

  for (let index = 0; index < fullZeroBytes; index += 1) {
    if (digest[index] !== 0) {
      return false;
    }
  }

  if (remainingBits === 0) {
    return true;
  }

  const mask = (0xff << (8 - remainingBits)) & 0xff;
  return (digest[fullZeroBytes] & mask) === 0;
};

const yieldToEventLoop = () =>
  new Promise<void>((resolve) => {
    globalThis.setTimeout(resolve, 0);
  });

export const solveProofOfWorkChallenge = async (
  proofOfWork: PasswordRecoveryChallengeProofOfWorkPayload['proofOfWork'],
  options?: {
    signal?: AbortSignal;
    onProgress?: (nonce: number) => void;
    maxIterations?: number;
  },
): Promise<string> => {
  const encoder = new TextEncoder();
  const maxIterations = options?.maxIterations ?? 5_000_000;
  const cryptoSubtle = globalThis.crypto?.subtle;

  if (!cryptoSubtle) {
    throw new Error('proof-of-work solver is unavailable in this environment');
  }

  for (let nonce = 0; nonce <= maxIterations; nonce += 1) {
    if (options?.signal?.aborted) {
      throw new DOMException('proof-of-work solver aborted', 'AbortError');
    }

    const digest = new Uint8Array(
      await cryptoSubtle.digest(
        'SHA-256',
        encoder.encode(`${proofOfWork.seed}:${nonce}`),
      ),
    );

    if (hasLeadingZeroBits(digest, proofOfWork.difficultyBits)) {
      return String(nonce);
    }

    if (nonce > 0 && nonce % 256 === 0) {
      options?.onProgress?.(nonce);
      await yieldToEventLoop();
    }
  }

  throw new Error('unable to solve proof-of-work challenge');
};
