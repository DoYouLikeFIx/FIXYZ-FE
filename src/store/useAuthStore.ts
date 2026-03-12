import { create } from 'zustand';

import type { LoginChallenge, Member } from '@/types/auth';

export type AuthStatus = 'checking' | 'anonymous' | 'authenticated';

export interface PendingMfaState extends LoginChallenge {
  redirectPath: string;
}

export interface AuthState {
  status: AuthStatus;
  member: Member | null;
  reauthMessage: string | null;
  pendingMfa: PendingMfaState | null;
  initialize: (member: Member | null) => void;
  login: (member: Member) => void;
  logout: () => void;
  requireReauth: (message: string) => void;
  clearReauthMessage: () => void;
  startMfaChallenge: (challenge: LoginChallenge, redirectPath: string) => void;
  updatePendingMfa: (
    updater: Partial<PendingMfaState> | ((current: PendingMfaState) => PendingMfaState),
  ) => void;
  clearPendingMfa: () => void;
}

const createAuthStoreState = (): AuthState => ({
  status: 'checking',
  member: null,
  reauthMessage: null,
  pendingMfa: null,
  initialize: (member) => {
    useAuthStore.setState({
      status: member ? 'authenticated' : 'anonymous',
      member,
      reauthMessage: null,
      pendingMfa: null,
    });
  },
  login: (member) => {
    useAuthStore.setState({
      status: 'authenticated',
      member,
      reauthMessage: null,
      pendingMfa: null,
    });
  },
  logout: () => {
    useAuthStore.setState({
      status: 'anonymous',
      member: null,
      reauthMessage: null,
      pendingMfa: null,
    });
  },
  requireReauth: (message) => {
    useAuthStore.setState({
      status: 'anonymous',
      member: null,
      reauthMessage: message,
      pendingMfa: null,
    });
  },
  clearReauthMessage: () => {
    useAuthStore.setState({
      reauthMessage: null,
    });
  },
  startMfaChallenge: (challenge, redirectPath) => {
    useAuthStore.setState({
      status: 'anonymous',
      member: null,
      reauthMessage: null,
      pendingMfa: {
        ...challenge,
        redirectPath,
      },
    });
  },
  updatePendingMfa: (updater) => {
    useAuthStore.setState((current) => {
      if (!current.pendingMfa) {
        return current;
      }

      return {
        pendingMfa:
          typeof updater === 'function'
            ? updater(current.pendingMfa)
            : {
                ...current.pendingMfa,
                ...updater,
              },
      };
    });
  },
  clearPendingMfa: () => {
    useAuthStore.setState({
      pendingMfa: null,
    });
  },
});

export const useAuthStore = create<AuthState>(createAuthStoreState);

export const resetAuthStore = () => {
  useAuthStore.setState(createAuthStoreState());
};
