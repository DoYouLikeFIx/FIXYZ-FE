export interface ApiErrorPayload {
  code: string;
  message: string;
  detail?: string | null;
  field?: string | null;
  timestamp?: string;
  [key: string]: unknown;
}

export interface ApiResponseEnvelope<T> {
  success: boolean;
  data: T | null;
  error: ApiErrorPayload | null;
  traceId?: string;
}
