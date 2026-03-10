import { act, renderHook } from '@testing-library/react';

import { useAppBootstrap } from '@/hooks/auth/useAppBootstrap';
import { resetAuthStore, useAuthStore } from '@/store/useAuthStore';
import type { Member } from '@/types/auth';

const mockFetchSession = vi.fn();

vi.mock('@/api/authApi', () => ({
  fetchSession: () => mockFetchSession(),
}));

const memberFixture: Member = {
  memberUuid: 'member-001',
  email: 'demo@fix.com',
  name: 'Demo User',
  role: 'ROLE_USER',
  totpEnrolled: true,
  accountId: '1',
};

const createDeferred = <T,>() => {
  let resolvePromise!: (value: T | PromiseLike<T>) => void;
  let rejectPromise!: (reason?: unknown) => void;

  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });

  return {
    promise,
    resolve: resolvePromise,
    reject: rejectPromise,
  };
};

describe('useAppBootstrap', () => {
  beforeEach(() => {
    mockFetchSession.mockReset();
    resetAuthStore();
  });

  it('ignores a stale bootstrap failure after auth state already became authenticated', async () => {
    const deferred = createDeferred<Member>();
    mockFetchSession.mockReturnValue(deferred.promise);

    renderHook(() => useAppBootstrap());

    act(() => {
      useAuthStore.getState().login(memberFixture);
    });

    await act(async () => {
      deferred.reject(new Error('Authentication required'));
      await Promise.resolve();
    });

    expect(useAuthStore.getState().status).toBe('authenticated');
    expect(useAuthStore.getState().member).toEqual(memberFixture);
  });
});
