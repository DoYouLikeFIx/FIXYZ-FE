import { useLocation } from 'react-router-dom';

import {
  buildLoginRedirect,
  buildRedirectPath,
} from '@/router/navigation';
import { useAuthStore } from '@/store/useAuthStore';

export const usePrivateRouteGuard = () => {
  const status = useAuthStore((state) => state.status);
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
