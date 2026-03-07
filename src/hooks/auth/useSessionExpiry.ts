import { useEffect } from 'react';

import type { SessionExpiryEventPayload } from '@/types/auth';

const STREAM_URL = '/api/v1/notifications/stream';
const RECONNECT_DELAY_MS = 3_000;

interface UseSessionExpiryOptions {
  enabled: boolean;
  onWarning: (remainingSeconds: number) => void;
}

const parseRemainingSeconds = (value: unknown) => {
  if (typeof value !== 'object' || value === null) {
    return null;
  }

  const remainingSeconds = (value as Partial<SessionExpiryEventPayload>).remainingSeconds;

  return typeof remainingSeconds === 'number' ? remainingSeconds : null;
};

export const useSessionExpiry = ({
  enabled,
  onWarning,
}: UseSessionExpiryOptions) => {
  useEffect(() => {
    if (!enabled) {
      return undefined;
    }

    let active = true;
    let stream: EventSource | null = null;
    let reconnectHandle: number | null = null;

    const handleExpiry = (event: MessageEvent<string>) => {
      try {
        const parsed = JSON.parse(event.data) as SessionExpiryEventPayload;
        const remainingSeconds = parseRemainingSeconds(parsed);

        if (remainingSeconds !== null) {
          onWarning(remainingSeconds);
        }
      } catch {
        // Ignore malformed event payloads and wait for the next server event.
      }
    };

    const connect = () => {
      stream = new EventSource(STREAM_URL, { withCredentials: true });
      stream.addEventListener('session-expiry', handleExpiry as EventListener);
      stream.onerror = () => {
        stream?.removeEventListener('session-expiry', handleExpiry as EventListener);
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

      stream?.removeEventListener('session-expiry', handleExpiry as EventListener);
      stream?.close();
    };
  }, [enabled, onWarning]);
};
