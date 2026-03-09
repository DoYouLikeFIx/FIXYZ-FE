import { resetAuthStore, useAuthStore } from '@/store/useAuthStore';
import type { Member } from '@/types/auth';

const memberFixture: Member = {
  memberUuid: 'member-001',
  username: 'demo',
  email: 'demo@fix.com',
  name: 'Demo User',
  role: 'ROLE_USER',
  totpEnrolled: true,
  accountId: 'ACC-001',
};

describe('useAuthStore', () => {
  beforeEach(() => {
    resetAuthStore();
  });

  it('stores the authenticated member and clears transient guidance on login', () => {
    const store = useAuthStore.getState();

    store.requireReauth('세션이 만료되었습니다. 다시 로그인해 주세요.');
    store.login(memberFixture);

    const state = useAuthStore.getState();
    expect(state.status).toBe('authenticated');
    expect(state.member).toEqual(memberFixture);
    expect(state.reauthMessage).toBeNull();
  });

  it('moves back to anonymous state when re-authentication is required', () => {
    const store = useAuthStore.getState();
    store.login(memberFixture);

    store.requireReauth('세션이 만료되었습니다. 다시 로그인해 주세요.');

    const state = useAuthStore.getState();
    expect(state.status).toBe('anonymous');
    expect(state.member).toBeNull();
    expect(state.reauthMessage).toBe('세션이 만료되었습니다. 다시 로그인해 주세요.');
  });

  it('tracks and clears the session-expiry warning banner', () => {
    const store = useAuthStore.getState();

    store.showSessionExpiryWarning(300);
    expect(useAuthStore.getState().sessionExpiryRemainingSeconds).toBe(300);

    store.clearSessionExpiryWarning();
    expect(useAuthStore.getState().sessionExpiryRemainingSeconds).toBeNull();
  });
});
