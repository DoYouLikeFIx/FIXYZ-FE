import axios, { AxiosError, type AxiosResponse } from 'axios';

import type { ApiResponseEnvelope } from '@/types/api';

export const DEFAULT_SERVER_ERROR_MESSAGE =
  'Unexpected server response. Please try again.';
export const NETWORK_ERROR_MESSAGE =
  'Unable to reach the server. Check your network and try again.';
export const TIMEOUT_ERROR_MESSAGE =
  'Request timed out. Please try again.';

const DEFAULT_BASE_URL = '/';

export interface NormalizedApiError extends Error {
  code?: string;
  status?: number;
  detail?: string;
}

export const isApiResponseEnvelope = (
  value: unknown,
): value is ApiResponseEnvelope<unknown> => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  return (
    typeof candidate.success === 'boolean' &&
    Object.hasOwn(candidate, 'data') &&
    Object.hasOwn(candidate, 'error')
  );
};

const buildNormalizedError = (
  message: string,
  options?: {
    code?: string;
    status?: number;
    detail?: string;
  },
): NormalizedApiError => {
  const normalized = new Error(message) as NormalizedApiError;
  normalized.name = 'ApiClientError';
  normalized.code = options?.code;
  normalized.status = options?.status;
  normalized.detail = options?.detail;

  return normalized;
};

const unwrapEnvelope = <T>(response: AxiosResponse<T>): AxiosResponse<T> => {
  const payload = response.data;

  if (!isApiResponseEnvelope(payload)) {
    return response;
  }

  if (!payload.success) {
    throw buildNormalizedError(
      payload.error?.message ?? DEFAULT_SERVER_ERROR_MESSAGE,
      {
        code: payload.error?.code,
        detail: payload.error?.detail,
        status: response.status,
      },
    );
  }

  response.data = payload.data as T;
  return response;
};

export const normalizeApiError = (error: unknown): NormalizedApiError => {
  if (!axios.isAxiosError(error)) {
    return buildNormalizedError(DEFAULT_SERVER_ERROR_MESSAGE);
  }

  const status = error.response?.status;
  const responseData = error.response?.data;

  if (isApiResponseEnvelope(responseData) && responseData.error) {
    return buildNormalizedError(
      responseData.error.message || DEFAULT_SERVER_ERROR_MESSAGE,
      {
        code: responseData.error.code,
        detail: responseData.error.detail,
        status,
      },
    );
  }

  if (error.code === AxiosError.ECONNABORTED) {
    return buildNormalizedError(TIMEOUT_ERROR_MESSAGE, { status });
  }

  if (!error.response) {
    return buildNormalizedError(NETWORK_ERROR_MESSAGE, { status });
  }

  return buildNormalizedError(DEFAULT_SERVER_ERROR_MESSAGE, { status });
};

const configuredBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim();

export const api = axios.create({
  baseURL: configuredBaseUrl && configuredBaseUrl.length > 0
    ? configuredBaseUrl
    : DEFAULT_BASE_URL,
  withCredentials: true,
  timeout: 10_000,
});

api.interceptors.response.use(
  (response) => unwrapEnvelope(response),
  (error: unknown) => Promise.reject(normalizeApiError(error)),
);
