export interface ApiErrorPayload {
  code: string;
  message: string;
  detail: string;
  details?: Record<string, unknown> | null;
  operatorCode?: string | null;
  retryAfterSeconds?: number | null;
  remainingAttempts?: number | null;
  enrollUrl?: string | null;
  recoveryUrl?: string | null;
  userMessageKey?: string | null;
  timestamp: string;
}

export interface ApiResponseEnvelope<T> {
  success: boolean;
  data: T | null;
  error: ApiErrorPayload | null;
  traceId?: string;
}

export type LenientApiResponseEnvelope<T> = Omit<ApiResponseEnvelope<T>, 'error'> & {
  error?: ApiErrorPayload | null;
};
