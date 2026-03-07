import { useSearchParams } from 'react-router-dom';

import { resolveRedirectTarget } from '@/router/navigation';
import { useAuthStore } from '@/store/useAuthStore';

export const usePublicOnlyRouteGuard = () => {
  const status = useAuthStore((state) => state.status);
  const [searchParams] = useSearchParams();

  return {
    status,
    redirectPath:
      status === 'authenticated'
        ? resolveRedirectTarget(searchParams.get('redirect'))
        : null,
    isChecking: status === 'checking',
  };
};
