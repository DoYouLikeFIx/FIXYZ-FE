import {
  type AuthState,
  useAuthStore,
} from '@/store/useAuthStore';

export function useAuth(): AuthState;
export function useAuth<T>(selector: (state: AuthState) => T): T;
export function useAuth<T>(selector?: (state: AuthState) => T) {
  return selector ? useAuthStore(selector) : useAuthStore();
}
