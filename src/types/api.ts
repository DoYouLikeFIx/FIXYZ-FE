export interface ApiErrorPayload {
  code: string;
  message: string;
  detail: string;
  operatorCode?: string | null;
  retryAfterSeconds?: number | null;
  enrollUrl?: string | null;
  userMessageKey?: string | null;
  timestamp: string;
}

export interface ApiResponseEnvelope<T> {
  success: boolean;
  data: T | null;
  error: ApiErrorPayload | null;
  traceId?: string;
}
