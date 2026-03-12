import { api, clearCsrfToken, fetchCsrfToken } from '@/lib/axios';
import type {
  LoginChallenge,
  LoginRequest,
  Member,
  PasswordForgotRequest,
  PasswordForgotResponse,
  PasswordRecoveryChallengeRequest,
  PasswordRecoveryChallengeResponse,
  PasswordResetRequest,
  RegisterRequest,
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

const createFormBody = (
  payload: Record<string, string>,
) => new URLSearchParams(payload);

const createCompatMember = (payload: AuthMutationResponse): Member => ({
  memberUuid: payload.memberUuid ?? String(payload.memberId ?? ''),
  email: payload.email,
  name: payload.name,
  role: payload.role ?? 'ROLE_USER',
  totpEnrolled: payload.totpEnrolled ?? false,
  accountId: payload.accountId ?? undefined,
});

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
): Promise<void> => {
  await api.post('/api/v1/auth/password/reset', payload, {
    _skipAuthHandling: true,
  });
};
