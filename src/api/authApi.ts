import { api, clearCsrfToken, fetchCsrfToken } from '@/lib/axios';
import type { LoginRequest, Member, RegisterRequest } from '@/types/auth';

interface AuthMutationResponse {
  memberId: number;
  email: string;
  name: string;
}

const isMember = (value: unknown): value is Member =>
  typeof value === 'object'
  && value !== null
  && 'memberUuid' in value
  && 'username' in value
  && 'email' in value
  && 'name' in value
  && 'role' in value
  && 'totpEnrolled' in value;

const createFormBody = (
  payload: Record<string, string>,
) => new URLSearchParams(payload);

const createCompatMember = (payload: AuthMutationResponse): Member => ({
  memberUuid: String(payload.memberId),
  username: payload.email.split('@')[0] ?? payload.email,
  email: payload.email,
  name: payload.name,
  role: 'ROLE_USER',
  totpEnrolled: false,
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
      email: payload.username,
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
