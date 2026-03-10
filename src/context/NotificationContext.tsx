import {
  useEffect,
  useMemo,
  useReducer,
  type ReactNode,
} from 'react';

import {
  NotificationContext,
  type NotificationContextValue,
} from '@/context/notification-context';
import type { SessionExpiryEventPayload } from '@/types/auth';
import { useAuthStore } from '@/store/useAuthStore';

const RECONNECT_DELAY_MS = 3_000;

interface NotificationState {
  sessionExpiryRemainingSeconds: number | null;
}

type NotificationAction =
  | {
      type: 'SESSION_EXPIRY_RECEIVED';
      remainingSeconds: number;
    }
  | {
      type: 'SESSION_EXPIRY_CLEARED';
    };

const initialNotificationState: NotificationState = {
  sessionExpiryRemainingSeconds: null,
};

const notificationReducer = (
  state: NotificationState,
  action: NotificationAction,
): NotificationState => {
  switch (action.type) {
    case 'SESSION_EXPIRY_RECEIVED':
      return {
        sessionExpiryRemainingSeconds: action.remainingSeconds,
      };
    case 'SESSION_EXPIRY_CLEARED':
      return initialNotificationState;
    default:
      return state;
  }
};

const parseRemainingSeconds = (value: unknown) => {
  if (typeof value !== 'object' || value === null) {
    return null;
  }

  const remainingSeconds = (value as Partial<SessionExpiryEventPayload>).remainingSeconds;

  return typeof remainingSeconds === 'number' ? remainingSeconds : null;
};

const resolveNotificationStreamUrl = () => {
  const configuredBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim();

  if (!configuredBaseUrl) {
    return '/api/v1/notifications/stream';
  }

  return new URL('/api/v1/notifications/stream', configuredBaseUrl).toString();
};

export function NotificationProvider({ children }: { children: ReactNode }) {
  const authStatus = useAuthStore((state) => state.status);
  const [state, dispatch] = useReducer(notificationReducer, initialNotificationState);

  useEffect(() => {
    if (authStatus !== 'authenticated') {
      dispatch({ type: 'SESSION_EXPIRY_CLEARED' });
      return undefined;
    }

    let active = true;
    let reconnectHandle: number | null = null;
    let stream: EventSource | null = null;

    const handleSessionExpiry = (event: MessageEvent<string>) => {
      try {
        const parsed = JSON.parse(event.data) as SessionExpiryEventPayload;
        const remainingSeconds = parseRemainingSeconds(parsed);

        if (remainingSeconds !== null) {
          dispatch({
            type: 'SESSION_EXPIRY_RECEIVED',
            remainingSeconds,
          });
        }
      } catch {
        // Ignore malformed payloads and keep the stream alive for the next event.
      }
    };

    const connect = () => {
      stream = new EventSource(resolveNotificationStreamUrl(), {
        withCredentials: true,
      });
      stream.addEventListener(
        'session-expiry',
        handleSessionExpiry as EventListener,
      );
      stream.onerror = () => {
        stream?.removeEventListener(
          'session-expiry',
          handleSessionExpiry as EventListener,
        );
        stream?.close();

        if (!active) {
          return;
        }

        reconnectHandle = window.setTimeout(connect, RECONNECT_DELAY_MS);
      };
    };

    connect();

    return () => {
      active = false;

      if (reconnectHandle !== null) {
        window.clearTimeout(reconnectHandle);
      }

      stream?.removeEventListener(
        'session-expiry',
        handleSessionExpiry as EventListener,
      );
      stream?.close();
    };
  }, [authStatus]);

  const value = useMemo<NotificationContextValue>(
    () => ({
      ...state,
      clearSessionExpiryWarning: () => {
        dispatch({ type: 'SESSION_EXPIRY_CLEARED' });
      },
    }),
    [state],
  );

  return (
    <NotificationContext.Provider value={value}>
      {children}
    </NotificationContext.Provider>
  );
}
