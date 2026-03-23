import { useEffect } from 'react';

import { fetchSession } from '@/api/authApi';
import { useAuth } from '@/hooks/auth/useAuth';
import { fetchCsrfToken } from '@/lib/axios';

export const useAppBootstrap = () => {
  const status = useAuth((state) => state.status);
  const initialize = useAuth((state) => state.initialize);

  useEffect(() => {
    if (status !== 'checking') {
      return undefined;
    }

    let active = true;

    // Pre-warm CSRF token at app start per architecture contract.
    void fetchCsrfToken().catch(() => undefined);

    const applyBootstrapResult = (member: Parameters<typeof initialize>[0]) => {
      if (!active || status !== 'checking') {
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
  }, [initialize, status]);
};
