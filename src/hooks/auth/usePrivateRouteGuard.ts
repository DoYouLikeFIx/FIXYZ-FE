import { useLocation } from 'react-router-dom';

import { useAuth } from '@/hooks/auth/useAuth';
import {
  buildLoginRedirect,
  buildRedirectPath,
} from '@/router/navigation';

export const usePrivateRouteGuard = () => {
  const status = useAuth((state) => state.status);
  const location = useLocation();

  return {
    status,
    redirectPath:
      status === 'authenticated'
        ? null
        : buildLoginRedirect(
            buildRedirectPath({
              pathname: location.pathname,
              search: location.search,
              hash: location.hash,
            }),
          ),
  };
};
