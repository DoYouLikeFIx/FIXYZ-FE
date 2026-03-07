import axios, {
  AxiosError,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from 'axios';

import { getReauthMessage, isReauthError } from '@/lib/auth-errors';
import { useAuthStore } from '@/store/useAuthStore';
import type { ApiResponseEnvelope } from '@/types/api';
import type { CsrfTokenPayload } from '@/types/auth';

declare module 'axios' {
  interface AxiosRequestConfig {
    _csrfRetried?: boolean;
    _skipCsrf?: boolean;
    _skipAuthHandling?: boolean;
  }
}

export const DEFAULT_SERVER_ERROR_MESSAGE =
  'Unexpected server response. Please try again.';
export const NETWORK_ERROR_MESSAGE =
  'Unable to reach the server. Check your network and try again.';
export const TIMEOUT_ERROR_MESSAGE =
  'Request timed out. Please try again.';
export const FORBIDDEN_ERROR_MESSAGE =
  '요청을 확인할 수 없습니다. 페이지를 새로고침한 뒤 다시 시도해 주세요.';

const DEFAULT_BASE_URL = '/';
const DEFAULT_CSRF_HEADER = 'X-CSRF-TOKEN';

export interface NormalizedApiError extends Error {
  code?: string;
  status?: number;
  detail?: string;
  traceId?: string;
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
    traceId?: string;
  },
): NormalizedApiError => {
  const normalized = new Error(message) as NormalizedApiError;
  normalized.name = 'ApiClientError';
  normalized.code = options?.code;
  normalized.status = options?.status;
  normalized.detail = options?.detail;
  normalized.traceId = options?.traceId;

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
        detail: payload.error?.detail ?? undefined,
        status: response.status,
        traceId: payload.traceId,
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
        detail: responseData.error.detail ?? undefined,
        status,
        traceId: responseData.traceId,
      },
    );
  }

  if (status === 403) {
    return buildNormalizedError(FORBIDDEN_ERROR_MESSAGE, { status });
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
const resolvedBaseUrl = configuredBaseUrl && configuredBaseUrl.length > 0
  ? configuredBaseUrl
  : DEFAULT_BASE_URL;

type ApiRequestConfig = InternalAxiosRequestConfig;

let csrfToken: string | null = null;
let csrfHeaderName = DEFAULT_CSRF_HEADER;
let csrfRequest: Promise<CsrfTokenPayload> | null = null;

const shouldAttachCsrf = (config: ApiRequestConfig) => {
  const method = config.method?.toLowerCase();

  if (config._skipCsrf) {
    return false;
  }

  return method !== undefined && !['get', 'head', 'options'].includes(method);
};

const isCsrfEndpoint = (url?: string) => url?.includes('/api/v1/auth/csrf') ?? false;

const shouldRetryCsrf = (config?: ApiRequestConfig) => {
  if (!config || config._csrfRetried || config._skipCsrf) {
    return false;
  }

  return shouldAttachCsrf(config) && !isCsrfEndpoint(config.url);
};

const csrfClient = axios.create({
  baseURL: resolvedBaseUrl,
  withCredentials: true,
  timeout: 10_000,
});

const setCsrfHeader = (config: ApiRequestConfig, token: string) => {
  if (config.headers.set) {
    config.headers.set(csrfHeaderName, token);
    return;
  }

  config.headers[csrfHeaderName] = token;
};

export const fetchCsrfToken = async (
  forceRefresh = false,
): Promise<CsrfTokenPayload> => {
  if (!forceRefresh && csrfToken) {
    return {
      csrfToken,
      headerName: csrfHeaderName,
    };
  }

  if (csrfRequest) {
    return csrfRequest;
  }

  csrfRequest = csrfClient
    .get<ApiResponseEnvelope<CsrfTokenPayload>>('/api/v1/auth/csrf')
    .then((response) => {
      const payload = response.data;

      if (!isApiResponseEnvelope(payload) || !payload.success || !payload.data) {
        throw buildNormalizedError(DEFAULT_SERVER_ERROR_MESSAGE);
      }

      csrfToken = payload.data.csrfToken;
      csrfHeaderName = payload.data.headerName || DEFAULT_CSRF_HEADER;

      return payload.data;
    })
    .finally(() => {
      csrfRequest = null;
    });

  return csrfRequest;
};

export const clearCsrfToken = () => {
  csrfToken = null;
  csrfHeaderName = DEFAULT_CSRF_HEADER;
};

const shouldHandleAuthFailure = (
  normalized: NormalizedApiError,
  config?: ApiRequestConfig,
) => {
  if (config?._skipAuthHandling) {
    return false;
  }

  if (!isReauthError(normalized)) {
    return false;
  }

  const url = config?.url ?? '';

  return ![
    '/api/v1/auth/login',
    '/api/v1/auth/register',
    '/api/v1/auth/csrf',
    '/api/v1/auth/session',
  ].some((segment) => url.includes(segment));
};

export const api = axios.create({
  baseURL: resolvedBaseUrl,
  withCredentials: true,
  timeout: 10_000,
});

api.interceptors.request.use(async (config) => {
  const request = config as ApiRequestConfig;

  if (!shouldAttachCsrf(request)) {
    return request;
  }

  const tokenPayload = await fetchCsrfToken();
  csrfHeaderName = tokenPayload.headerName || DEFAULT_CSRF_HEADER;
  csrfToken = tokenPayload.csrfToken;
  setCsrfHeader(request, tokenPayload.csrfToken);

  return request;
});

api.interceptors.response.use(
  (response) => unwrapEnvelope(response),
  async (error: unknown) => {
    if (axios.isAxiosError(error)) {
      const config = error.config as ApiRequestConfig | undefined;

      if (error.response?.status === 403 && shouldRetryCsrf(config)) {
        const refreshed = await fetchCsrfToken(true);
        const retryConfig = config as ApiRequestConfig;
        retryConfig._csrfRetried = true;
        csrfHeaderName = refreshed.headerName || DEFAULT_CSRF_HEADER;
        csrfToken = refreshed.csrfToken;
        setCsrfHeader(retryConfig, refreshed.csrfToken);

        return api.request(retryConfig);
      }
    }

    const normalized = normalizeApiError(error);
    const config = axios.isAxiosError(error)
      ? (error.config as ApiRequestConfig | undefined)
      : undefined;

    if (shouldHandleAuthFailure(normalized, config)) {
      useAuthStore.getState().requireReauth(getReauthMessage(normalized));
    }

    return Promise.reject(normalized);
  },
);
