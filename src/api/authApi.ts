import { api, clearCsrfToken, fetchCsrfToken } from '@/lib/axios';
import type { LoginRequest, Member, RegisterRequest } from '@/types/auth';

export const fetchSession = async (): Promise<Member> => {
  const response = await api.get<Member>('/api/v1/auth/session', {
    _skipAuthHandling: true,
  });

  return response.data;
};

export const loginMember = async (payload: LoginRequest): Promise<Member> => {
  const response = await api.post<Member>('/api/v1/auth/login', payload, {
    _skipAuthHandling: true,
  });

  await fetchCsrfToken(true);

  return response.data;
};

export const registerMember = async (
  payload: RegisterRequest,
): Promise<Member> => {
  const response = await api.post<Member>('/api/v1/auth/register', payload, {
    _skipAuthHandling: true,
  });

  clearCsrfToken();

  return response.data;
};
