import { useEffect } from 'react';

import { fetchSession } from '@/api/authApi';
import { fetchCsrfToken } from '@/lib/axios';
import { useAuthStore } from '@/store/useAuthStore';

export const useAppBootstrap = () => {
  const initialize = useAuthStore((state) => state.initialize);

  useEffect(() => {
    let active = true;

    // Pre-warm CSRF token at app start per architecture contract.
    void fetchCsrfToken().catch(() => undefined);

    const applyBootstrapResult = (member: Parameters<typeof initialize>[0]) => {
      if (!active || useAuthStore.getState().status !== 'checking') {
        return;
      }

      initialize(member);
    };

    void fetchSession()
      .then((member) => {
        applyBootstrapResult(member);
      })
      .catch(() => {
        applyBootstrapResult(null);
      });

    return () => {
      active = false;
    };
  }, [initialize]);
};
