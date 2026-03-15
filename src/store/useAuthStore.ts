import { create } from 'zustand';

import { clearAllPersistedOrderSessionIds } from '@/order/order-session-storage';
import type { LoginChallenge, Member, TotpRebindBootstrap } from '@/types/auth';

export type AuthStatus = 'checking' | 'anonymous' | 'authenticated';

export interface PendingMfaState extends LoginChallenge {
  redirectPath: string;
  email?: string;
}

export interface MfaRecoveryState {
  suggestedEmail: string;
  recoveryProof: string | null;
  recoveryProofExpiresInSeconds: number | null;
  bootstrap: TotpRebindBootstrap | null;
}

export interface AuthState {
  status: AuthStatus;
  member: Member | null;
  reauthMessage: string | null;
  pendingMfa: PendingMfaState | null;
  mfaRecovery: MfaRecoveryState | null;
  initialize: (member: Member | null) => void;
  login: (member: Member) => void;
  logout: () => void;
  requireReauth: (message: string) => void;
  clearReauthMessage: () => void;
  startMfaChallenge: (challenge: LoginChallenge, redirectPath: string, email?: string) => void;
  updatePendingMfa: (
    updater: Partial<PendingMfaState> | ((current: PendingMfaState) => PendingMfaState),
  ) => void;
  clearPendingMfa: () => void;
  openMfaRecovery: (suggestedEmail?: string) => void;
  storeMfaRecoveryProof: (
    recoveryProof: string,
    recoveryProofExpiresInSeconds?: number,
    suggestedEmail?: string,
  ) => void;
  storeMfaRecoveryBootstrap: (bootstrap: TotpRebindBootstrap) => void;
  clearMfaRecovery: () => void;
}

const createAuthStoreState = (): AuthState => ({
  status: 'checking',
  member: null,
  reauthMessage: null,
  pendingMfa: null,
  mfaRecovery: null,
  initialize: (member) => {
    useAuthStore.setState({
      status: member ? 'authenticated' : 'anonymous',
      member,
      reauthMessage: null,
      pendingMfa: null,
      mfaRecovery: null,
    });
  },
  login: (member) => {
    useAuthStore.setState({
      status: 'authenticated',
      member,
      reauthMessage: null,
      pendingMfa: null,
      mfaRecovery: null,
    });
  },
  logout: () => {
    clearAllPersistedOrderSessionIds();
    useAuthStore.setState({
      status: 'anonymous',
      member: null,
      reauthMessage: null,
      pendingMfa: null,
      mfaRecovery: null,
    });
  },
  requireReauth: (message) => {
    clearAllPersistedOrderSessionIds();
    useAuthStore.setState({
      status: 'anonymous',
      member: null,
      reauthMessage: message,
      pendingMfa: null,
      mfaRecovery: null,
    });
  },
  clearReauthMessage: () => {
    useAuthStore.setState({
      reauthMessage: null,
    });
  },
  startMfaChallenge: (challenge, redirectPath, email) => {
    useAuthStore.setState({
      status: 'anonymous',
      member: null,
      reauthMessage: null,
      pendingMfa: {
        ...challenge,
        redirectPath,
        email,
      },
      mfaRecovery: null,
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
  openMfaRecovery: (suggestedEmail) => {
    useAuthStore.setState((current) => ({
      pendingMfa: null,
      mfaRecovery: {
        suggestedEmail: suggestedEmail?.trim() ?? current.mfaRecovery?.suggestedEmail ?? '',
        recoveryProof: current.mfaRecovery?.recoveryProof ?? null,
        recoveryProofExpiresInSeconds: current.mfaRecovery?.recoveryProofExpiresInSeconds ?? null,
        bootstrap: current.mfaRecovery?.bootstrap ?? null,
      },
    }));
  },
  storeMfaRecoveryProof: (recoveryProof, recoveryProofExpiresInSeconds, suggestedEmail) => {
    useAuthStore.setState((current) => ({
      pendingMfa: null,
      mfaRecovery: {
        suggestedEmail: suggestedEmail?.trim() ?? current.mfaRecovery?.suggestedEmail ?? '',
        recoveryProof: recoveryProof.trim(),
        recoveryProofExpiresInSeconds: recoveryProofExpiresInSeconds ?? null,
        bootstrap: null,
      },
    }));
  },
  storeMfaRecoveryBootstrap: (bootstrap) => {
    useAuthStore.setState((current) => ({
      mfaRecovery: {
        suggestedEmail: current.mfaRecovery?.suggestedEmail ?? '',
        recoveryProof: current.mfaRecovery?.recoveryProof ?? null,
        recoveryProofExpiresInSeconds: current.mfaRecovery?.recoveryProofExpiresInSeconds ?? null,
        bootstrap,
      },
    }));
  },
  clearMfaRecovery: () => {
    useAuthStore.setState({
      mfaRecovery: null,
    });
  },
});

export const useAuthStore = create<AuthState>(createAuthStoreState);

export const resetAuthStore = () => {
  useAuthStore.setState(createAuthStoreState());
};
