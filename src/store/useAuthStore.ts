import { create } from 'zustand';

import type { Member } from '@/types/auth';

export type AuthStatus = 'checking' | 'anonymous' | 'authenticated';

export interface AuthState {
  status: AuthStatus;
  member: Member | null;
  reauthMessage: string | null;
  initialize: (member: Member | null) => void;
  login: (member: Member) => void;
  logout: () => void;
  requireReauth: (message: string) => void;
  clearReauthMessage: () => void;
}

const createAuthStoreState = (): AuthState => ({
  status: 'checking',
  member: null,
  reauthMessage: null,
  initialize: (member) => {
    useAuthStore.setState({
      status: member ? 'authenticated' : 'anonymous',
      member,
      reauthMessage: null,
    });
  },
  login: (member) => {
    useAuthStore.setState({
      status: 'authenticated',
      member,
      reauthMessage: null,
    });
  },
  logout: () => {
    useAuthStore.setState({
      status: 'anonymous',
      member: null,
      reauthMessage: null,
    });
  },
  requireReauth: (message) => {
    useAuthStore.setState({
      status: 'anonymous',
      member: null,
      reauthMessage: message,
    });
  },
  clearReauthMessage: () => {
    useAuthStore.setState({
      reauthMessage: null,
    });
  },
});

export const useAuthStore = create<AuthState>(createAuthStoreState);

export const resetAuthStore = () => {
  useAuthStore.setState(createAuthStoreState());
};
