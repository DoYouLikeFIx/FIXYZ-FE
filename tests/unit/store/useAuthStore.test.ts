import { resetAuthStore, useAuthStore } from '@/store/useAuthStore';
import type { Member } from '@/types/auth';

const memberFixture: Member = {
  memberUuid: 'member-001',
  email: 'demo@fix.com',
  name: 'Demo User',
  role: 'ROLE_USER',
  totpEnrolled: true,
  accountId: '1',
};

describe('useAuthStore', () => {
  beforeEach(() => {
    resetAuthStore();
    window.sessionStorage.clear();
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
    window.sessionStorage.setItem('fixyz.order-session-id:1', 'sess-001');

    store.requireReauth('세션이 만료되었습니다. 다시 로그인해 주세요.');

    const state = useAuthStore.getState();
    expect(state.status).toBe('anonymous');
    expect(state.member).toBeNull();
    expect(state.reauthMessage).toBe('세션이 만료되었습니다. 다시 로그인해 주세요.');
    expect(window.sessionStorage.getItem('fixyz.order-session-id:1')).toBeNull();
  });

  it('clears persisted order-session keys on logout', () => {
    const store = useAuthStore.getState();
    store.login(memberFixture);
    window.sessionStorage.setItem('fixyz.order-session-id:1', 'sess-001');
    window.sessionStorage.setItem('fixyz.order-session-id:2', 'sess-002');

    store.logout();

    expect(window.sessionStorage.getItem('fixyz.order-session-id:1')).toBeNull();
    expect(window.sessionStorage.getItem('fixyz.order-session-id:2')).toBeNull();
  });

  it('clears re-auth guidance when requested', () => {
    const store = useAuthStore.getState();

    store.requireReauth('세션이 만료되었습니다. 다시 로그인해 주세요.');
    store.clearReauthMessage();

    expect(useAuthStore.getState().reauthMessage).toBeNull();
  });
});
