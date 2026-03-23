import {
  type AuthState,
  useAuthStore,
} from '@/store/useAuthStore';

const selectAuthState = (state: AuthState) => state;

export function useAuth(): AuthState;
export function useAuth<T>(selector: (state: AuthState) => T): T;
export function useAuth<T>(selector?: (state: AuthState) => T) {
  return useAuthStore((selector ?? selectAuthState) as (state: AuthState) => T);
}
