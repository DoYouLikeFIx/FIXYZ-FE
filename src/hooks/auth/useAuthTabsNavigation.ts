import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';

import type { AuthMode } from '@/types/auth-ui';

type AuthRoutePath = '/login' | '/register';

const NAVIGATION_DELAY_MS = 170;

const resolveAuthMode = (path: AuthRoutePath): AuthMode =>
  path === '/login' ? 'login' : 'register';

export const useAuthTabsNavigation = (mode: AuthMode) => {
  const navigate = useNavigate();
  const [displayMode, setDisplayMode] = useState(mode);
  const navigateTimerRef = useRef<number | null>(null);

  useEffect(() => {
    setDisplayMode(mode);
  }, [mode]);

  useEffect(
    () => () => {
      if (navigateTimerRef.current !== null) {
        window.clearTimeout(navigateTimerRef.current);
      }
    },
    [],
  );

  const handleTabNavigation = (path: AuthRoutePath) => (
    event: MouseEvent<HTMLAnchorElement>,
  ) => {
    if (
      mode === path.slice(1) ||
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.altKey ||
      event.ctrlKey ||
      event.shiftKey
    ) {
      return;
    }

    event.preventDefault();
    setDisplayMode(resolveAuthMode(path));

    if (navigateTimerRef.current !== null) {
      window.clearTimeout(navigateTimerRef.current);
    }

    navigateTimerRef.current = window.setTimeout(() => {
      navigate(path);
    }, NAVIGATION_DELAY_MS);
  };

  return {
    displayMode,
    handleTabNavigation,
  };
};
