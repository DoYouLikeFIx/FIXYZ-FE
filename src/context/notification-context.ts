import { createContext } from 'react';

interface NotificationState {
  sessionExpiryRemainingSeconds: number | null;
}

export interface NotificationContextValue extends NotificationState {
  clearSessionExpiryWarning: () => void;
}

export const NotificationContext = createContext<NotificationContextValue | null>(null);
