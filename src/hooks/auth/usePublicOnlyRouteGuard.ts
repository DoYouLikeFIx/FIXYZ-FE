import { useLocation, useSearchParams } from 'react-router-dom';

import { useAuth } from '@/hooks/auth/useAuth';
import {
  LOGIN_ROUTE,
  buildLoginRedirect,
  buildTotpEnrollmentRedirect,
  resolveRedirectTarget,
} from '@/router/navigation';

export const usePublicOnlyRouteGuard = () => {
  const status = useAuth((state) => state.status);
  const pendingMfa = useAuth((state) => state.pendingMfa);
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const currentRedirectPath = searchParams.get('redirect');
  const pendingRedirectPath = pendingMfa
    ? resolveRedirectTarget(pendingMfa.redirectPath)
    : null;

  const pendingMfaRedirectPath =
    pendingMfa?.nextAction === 'ENROLL_TOTP'
      ? buildTotpEnrollmentRedirect(pendingMfa.redirectPath)
      : pendingMfa?.nextAction === 'VERIFY_TOTP'
        && (
          location.pathname !== LOGIN_ROUTE
          || currentRedirectPath !== pendingRedirectPath
        )
        ? buildLoginRedirect(pendingMfa.redirectPath)
        : null;

  return {
    status,
    pendingMfaRedirectPath,
    redirectPath:
      status === 'authenticated'
        ? resolveRedirectTarget(searchParams.get('redirect'))
        : null,
    isChecking: status === 'checking',
  };
};
