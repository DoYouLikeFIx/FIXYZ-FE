import { api, clearCsrfToken, fetchCsrfToken } from '@/lib/axios';
import type {
  LoginRequest,
  Member,
  PasswordForgotRequest,
  PasswordForgotResponse,
  PasswordRecoveryChallengeRequest,
  PasswordRecoveryChallengeResponse,
  PasswordResetRequest,
  RegisterRequest,
} from '@/types/auth';

interface AuthMutationResponse {
  memberId?: number;
  memberUuid?: string;
  email: string;
  name: string;
  role?: string;
  totpEnrolled?: boolean;
  accountId?: string | null;
}

const isMember = (value: unknown): value is Member =>
  typeof value === 'object'
  && value !== null
  && 'memberUuid' in value
  && 'email' in value
  && 'name' in value
  && 'role' in value
  && 'totpEnrolled' in value;

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

export const loginMember = async (payload: LoginRequest): Promise<Member> => {
  const response = await api.post<Member | AuthMutationResponse>(
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

  await fetchCsrfToken(true);

  if (isMember(response.data)) {
    return response.data;
  }

  return fetchSession();
};

export const registerMember = async (
  payload: RegisterRequest,
): Promise<Member> => {
  const response = await api.post<Member | AuthMutationResponse>(
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

  if (isMember(response.data)) {
    return response.data;
  }

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
