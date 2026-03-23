import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { fetchSession } from '@/api/authApi';
import { useNotification } from '@/hooks/useNotification';
import { useAuth } from '@/hooks/auth/useAuth';
import {
  getAuthErrorMessage,
  getReauthMessage,
  isReauthError,
} from '@/lib/auth-errors';
import {
  buildLoginRedirect,
  buildRedirectPath,
} from '@/router/navigation';
export const useProtectedSession = () => {
  const member = useAuth((state) => state.member);
  const login = useAuth((state) => state.login);
  const requireReauth = useAuth((state) => state.requireReauth);
  const {
    sessionExpiryRemainingSeconds: remainingSeconds,
    sessionExpiryMonitoringUnavailable,
    notifications,
    isHydratingNotifications,
    notificationFeedUnavailable,
    notificationFeedErrorMessage,
    notificationReadErrorMessage,
    clearSessionExpiryWarning,
    markNotificationRead,
    refreshNotifications,
  } = useNotification();
  const navigate = useNavigate();
  const location = useLocation();
  const [isExtending, setIsExtending] = useState(false);
  const [extensionError, setExtensionError] = useState<string | null>(null);

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
        clearSessionExpiryWarning();
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
    sessionExpiryMonitoringUnavailable,
    notifications,
    isHydratingNotifications,
    notificationFeedUnavailable,
    notificationFeedErrorMessage,
    notificationReadErrorMessage,
    isExtending,
    extensionError,
    handleExtendSession,
    markNotificationRead,
    refreshNotifications,
  };
};
