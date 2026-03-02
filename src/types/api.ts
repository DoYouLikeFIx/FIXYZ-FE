export interface ApiErrorPayload {
  code: string;
  message: string;
  detail: string;
  timestamp: string;
}

export interface ApiResponseEnvelope<T> {
  success: boolean;
  data: T | null;
  error: ApiErrorPayload | null;
}
