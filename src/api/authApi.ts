import { api, clearCsrfToken, fetchCsrfToken } from '@/lib/axios';
import {
  type RecoveryChallengeFailClosedTelemetryEvent,
} from '@/lib/recovery-challenge';
import type {
  LoginChallenge,
  LoginRequest,
  MemberTotpRebindRequest,
  Member,
  MfaRecoveryRebindConfirmRequest,
  MfaRecoveryRebindConfirmResponse,
  MfaRecoveryRebindRequest,
  PasswordForgotRequest,
  PasswordForgotResponse,
  PasswordRecoveryChallengeRequest,
  PasswordRecoveryChallengeResponse,
  PasswordResetContinuation,
  PasswordResetRequest,
  RegisterRequest,
  TotpRebindBootstrap,
  TotpEnrollmentBootstrap,
  TotpEnrollmentConfirmationRequest,
  TotpEnrollmentRequest,
  TotpVerificationRequest,
} from '@/types/auth';

interface AuthMutationResponse {
  verified?: boolean;
  memberId?: number;
  memberUuid?: string;
  email: string;
  name: string;
  role?: string;
  totpEnrolled?: boolean;
  accountId?: string | null;
}

const getHeaderValue = (
  headers: unknown,
  name: string,
) => {
  if (!headers) {
    return undefined;
  }

  if (
    typeof headers === 'object'
    && headers !== null
    && 'get' in headers
    && typeof (headers as { get: (headerName: string) => unknown }).get === 'function'
  ) {
    const value = (headers as { get: (headerName: string) => unknown }).get(name);
    return typeof value === 'string' ? value : undefined;
  }

  if (typeof headers === 'object' && headers !== null) {
    const record = headers as Record<string, unknown>;
    const direct = record[name] ?? record[name.toLowerCase()] ?? record[name.toUpperCase()];

    if (Array.isArray(direct)) {
      return typeof direct[0] === 'string' ? direct[0] : undefined;
    }

    return typeof direct === 'string' ? direct : undefined;
  }

  return undefined;
};

const createFormBody = (
  payload: Record<string, string>,
) => new URLSearchParams(payload);

const RECOVERY_CHALLENGE_FAIL_CLOSED_PATH =
  '/api/v1/auth/password/forgot/challenge/fail-closed';
const CSRF_PARAMETER_NAME = '_csrf';
const MFA_BOOTSTRAP_TIMEOUT_MS = 30_000;

const createCompatMember = (payload: AuthMutationResponse): Member => ({
  memberUuid: payload.memberUuid ?? String(payload.memberId ?? ''),
  email: payload.email,
  name: payload.name,
  role: payload.role ?? 'ROLE_USER',
  totpEnrolled: payload.totpEnrolled ?? false,
  accountId: payload.accountId ?? undefined,
});

export const sendPasswordRecoveryChallengeFailClosedTelemetry = async (
  event: RecoveryChallengeFailClosedTelemetryEvent,
) => {
  const csrf = await fetchCsrfToken();
  const payload: Record<string, string> = {
    reason: event.payload.reason,
    surface: event.payload.surface,
    [CSRF_PARAMETER_NAME]: csrf.csrfToken,
  };
  if (typeof event.payload.challengeIssuedAtEpochMs === 'number') {
    payload.challengeIssuedAtEpochMs = String(event.payload.challengeIssuedAtEpochMs);
  }
  const body = createFormBody(payload);

  if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
    const sent = navigator.sendBeacon(RECOVERY_CHALLENGE_FAIL_CLOSED_PATH, body);
    if (sent) {
      return;
    }
  }

  if (typeof globalThis.fetch === 'function') {
    await globalThis.fetch(RECOVERY_CHALLENGE_FAIL_CLOSED_PATH, {
      method: 'POST',
      credentials: 'include',
      keepalive: true,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      },
      body: body.toString(),
    });
    return;
  }

  await api.post(
    RECOVERY_CHALLENGE_FAIL_CLOSED_PATH,
    body.toString(),
    {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      },
      _skipAuthHandling: true,
    },
  );
};

export const fetchSession = async (): Promise<Member> => {
  const response = await api.get<Member>('/api/v1/auth/session', {
    _skipAuthHandling: true,
  });

  return response.data;
};

export const startLoginFlow = async (
  payload: LoginRequest,
): Promise<LoginChallenge> => {
  const response = await api.post<LoginChallenge>(
    '/api/v1/auth/login',
    createFormBody({
      email: payload.email,
      password: payload.password,
    }),
    {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      _skipAuthHandling: true,
    },
  );

  return response.data;
};

export const registerMember = async (
  payload: RegisterRequest,
): Promise<Member> => {
  const response = await api.post<AuthMutationResponse>(
    '/api/v1/auth/register',
    createFormBody({
      email: payload.email,
      password: payload.password,
      name: payload.name,
    }),
    {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      _skipAuthHandling: true,
    },
  );

  clearCsrfToken();

  return createCompatMember(response.data);
};

export const verifyLoginOtp = async (
  payload: TotpVerificationRequest,
): Promise<Member> => {
  const response = await api.post<AuthMutationResponse>(
    '/api/v1/auth/otp/verify',
    payload,
    {
      _skipAuthHandling: true,
    },
  );

  await fetchCsrfToken(true);

  return createCompatMember(response.data);
};

export const beginTotpEnrollment = async (
  payload: TotpEnrollmentRequest,
): Promise<TotpEnrollmentBootstrap> => {
  const response = await api.post<TotpEnrollmentBootstrap>(
    '/api/v1/members/me/totp/enroll',
    payload,
    {
      timeout: MFA_BOOTSTRAP_TIMEOUT_MS,
      _skipAuthHandling: true,
    },
  );

  return response.data;
};

export const confirmTotpEnrollment = async (
  payload: TotpEnrollmentConfirmationRequest,
): Promise<Member> => {
  const response = await api.post<AuthMutationResponse>(
    '/api/v1/members/me/totp/confirm',
    payload,
    {
      _skipAuthHandling: true,
    },
  );

  await fetchCsrfToken(true);

  return createCompatMember(response.data);
};

export const requestPasswordResetEmail = async (
  payload: PasswordForgotRequest,
): Promise<PasswordForgotResponse> => {
  const response = await api.post<PasswordForgotResponse>(
    '/api/v1/auth/password/forgot',
    payload,
    {
      _skipAuthHandling: true,
    },
  );

  return response.data;
};

export const requestPasswordRecoveryChallenge = async (
  payload: PasswordRecoveryChallengeRequest,
): Promise<PasswordRecoveryChallengeResponse> => {
  const response = await api.post<PasswordRecoveryChallengeResponse>(
    '/api/v1/auth/password/forgot/challenge',
    payload,
    {
      _skipAuthHandling: true,
    },
  );

  return response.data;
};

export const resetPassword = async (
  payload: PasswordResetRequest,
): Promise<PasswordResetContinuation> => {
  const response = await api.post('/api/v1/auth/password/reset', payload, {
    _skipAuthHandling: true,
  });

  const recoveryProof = getHeaderValue(response.headers, 'X-MFA-Recovery-Proof');
  const rawExpiresIn = getHeaderValue(response.headers, 'X-MFA-Recovery-Proof-Expires-In');
  const recoveryProofExpiresInSeconds = rawExpiresIn ? Number(rawExpiresIn) : undefined;

  return {
    recoveryProof: recoveryProof?.trim() ? recoveryProof : undefined,
    recoveryProofExpiresInSeconds:
      recoveryProofExpiresInSeconds !== undefined && Number.isFinite(recoveryProofExpiresInSeconds)
        ? recoveryProofExpiresInSeconds
        : undefined,
  };
};

export const bootstrapAuthenticatedTotpRebind = async (
  payload: MemberTotpRebindRequest,
): Promise<TotpRebindBootstrap> => {
  const response = await api.post<TotpRebindBootstrap>(
    '/api/v1/members/me/totp/rebind',
    payload,
    {
      timeout: MFA_BOOTSTRAP_TIMEOUT_MS,
      _skipAuthHandling: true,
    },
  );

  return response.data;
};

export const bootstrapRecoveryTotpRebind = async (
  payload: MfaRecoveryRebindRequest,
): Promise<TotpRebindBootstrap> => {
  const response = await api.post<TotpRebindBootstrap>(
    '/api/v1/auth/mfa-recovery/rebind',
    payload,
    {
      timeout: MFA_BOOTSTRAP_TIMEOUT_MS,
      _skipAuthHandling: true,
    },
  );

  return response.data;
};

export const confirmMfaRecoveryRebind = async (
  payload: MfaRecoveryRebindConfirmRequest,
): Promise<MfaRecoveryRebindConfirmResponse> => {
  const response = await api.post<MfaRecoveryRebindConfirmResponse>(
    '/api/v1/auth/mfa-recovery/rebind/confirm',
    payload,
    {
      _skipAuthHandling: true,
    },
  );

  clearCsrfToken();
  await Promise.resolve(fetchCsrfToken(true)).catch(() => undefined);

  return response.data;
};
