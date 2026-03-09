import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { fetchSession } from '@/api/authApi';
import { useSessionExpiry } from '@/hooks/auth/useSessionExpiry';
import {
  getAuthErrorMessage,
  getReauthMessage,
  isReauthError,
} from '@/lib/auth-errors';
import {
  buildLoginRedirect,
  buildRedirectPath,
} from '@/router/navigation';
import { useAuthStore } from '@/store/useAuthStore';

export const useProtectedSession = () => {
  const member = useAuthStore((state) => state.member);
  const login = useAuthStore((state) => state.login);
  const requireReauth = useAuthStore((state) => state.requireReauth);
  const showSessionExpiryWarning = useAuthStore(
    (state) => state.showSessionExpiryWarning,
  );
  const clearSessionExpiryWarning = useAuthStore(
    (state) => state.clearSessionExpiryWarning,
  );
  const remainingSeconds = useAuthStore(
    (state) => state.sessionExpiryRemainingSeconds,
  );
  const navigate = useNavigate();
  const location = useLocation();
  const [isExtending, setIsExtending] = useState(false);
  const [extensionError, setExtensionError] = useState<string | null>(null);

  useSessionExpiry({
    enabled: Boolean(member),
    onWarning: showSessionExpiryWarning,
  });

  const handleExtendSession = async () => {
    setIsExtending(true);
    setExtensionError(null);

    try {
      const refreshedMember = await fetchSession();
      login(refreshedMember);
      clearSessionExpiryWarning();
      setExtensionError(null);
    } catch (error) {
      if (isReauthError(error)) {
        requireReauth(getReauthMessage(error));
        navigate(
          buildLoginRedirect(
            buildRedirectPath({
              pathname: location.pathname,
              search: location.search,
              hash: location.hash,
            }),
          ),
          { replace: true },
        );
      } else {
        setExtensionError(getAuthErrorMessage(error));
      }
    } finally {
      setIsExtending(false);
    }
  };

  return {
    member,
    remainingSeconds,
    isExtending,
    extensionError,
    handleExtendSession,
  };
};
