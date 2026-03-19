import axios, {
  AxiosError,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from 'axios';

import {
  DEFAULT_SERVER_ERROR_MESSAGE,
  FORBIDDEN_ERROR_MESSAGE,
  NETWORK_ERROR_MESSAGE,
  TIMEOUT_ERROR_MESSAGE,
} from '@/lib/api-error-messages';
import { getReauthMessage, isReauthError } from '@/lib/auth-errors';
import { useAuthStore } from '@/store/useAuthStore';
import type {
  LenientApiResponseEnvelope,
} from '@/types/api';
import type { CsrfTokenPayload } from '@/types/auth';

export {
  DEFAULT_SERVER_ERROR_MESSAGE,
  FORBIDDEN_ERROR_MESSAGE,
  NETWORK_ERROR_MESSAGE,
  TIMEOUT_ERROR_MESSAGE,
} from '@/lib/api-error-messages';

declare module 'axios' {
  interface AxiosRequestConfig {
    _csrfRetried?: boolean;
    _skipCsrf?: boolean;
    _skipAuthHandling?: boolean;
  }
}

const DEFAULT_BASE_URL = '/';
const DEFAULT_CSRF_HEADER = 'X-CSRF-TOKEN';

export interface NormalizedApiError extends Error {
  code?: string;
  status?: number;
  detail?: string;
  traceId?: string;
  operatorCode?: string;
  retryAfterSeconds?: number;
  remainingAttempts?: number;
  enrollUrl?: string;
  recoveryUrl?: string;
  userMessageKey?: string;
}

interface DirectApiErrorPayload {
  code?: string;
  message?: string;
  path?: string;
  correlationId?: string;
  operatorCode?: string;
  retryAfterSeconds?: unknown;
  remainingAttempts?: unknown;
  enrollUrl?: string;
  recoveryUrl?: string;
  userMessageKey?: string;
  timestamp?: string;
}

export const isApiResponseEnvelope = (
  value: unknown,
): value is LenientApiResponseEnvelope<unknown> => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  return (
    typeof candidate.success === 'boolean' &&
    Object.hasOwn(candidate, 'data')
  );
};

const isDirectApiErrorPayload = (
  value: unknown,
): value is DirectApiErrorPayload => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  return (
    typeof candidate.code === 'string' &&
    typeof candidate.message === 'string'
  );
};

export const createNormalizedApiError = (
  message: string,
  options?: {
    code?: string;
    status?: number;
    detail?: string;
    traceId?: string;
    operatorCode?: string;
    retryAfterSeconds?: number;
    remainingAttempts?: number;
    enrollUrl?: string;
    recoveryUrl?: string;
    userMessageKey?: string;
  },
): NormalizedApiError => {
  const normalized = new Error(message) as NormalizedApiError;
  normalized.name = 'ApiClientError';
  normalized.code = options?.code;
  normalized.status = options?.status;
  normalized.detail = options?.detail;
  normalized.traceId = options?.traceId;
  normalized.operatorCode = options?.operatorCode;
  normalized.retryAfterSeconds = options?.retryAfterSeconds;
  normalized.remainingAttempts = options?.remainingAttempts;
  normalized.enrollUrl = options?.enrollUrl;
  normalized.recoveryUrl = options?.recoveryUrl;
  normalized.userMessageKey = options?.userMessageKey;

  return normalized;
};

const parseRetryAfterSeconds = (value: unknown) => {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return Math.ceil(value);
  }

  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();

  if (!trimmed) {
    return undefined;
  }

  const asNumber = Number(trimmed);

  if (Number.isFinite(asNumber) && asNumber >= 0) {
    return Math.ceil(asNumber);
  }

  const asDate = Date.parse(trimmed);

  if (Number.isNaN(asDate)) {
    return undefined;
  }

  return Math.max(0, Math.ceil((asDate - Date.now()) / 1000));
};

const parseRemainingAttempts = (value: unknown) => {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return Math.trunc(value);
  }

  if (typeof value === 'string' && /^\d+$/.test(value)) {
    return Number.parseInt(value, 10);
  }

  return undefined;
};

const getHeaderValue = (headers: unknown, name: string) => {
  if (!headers) {
    return undefined;
  }

  if (
    typeof headers === 'object'
    && headers !== null
    && 'get' in headers
    && typeof (headers as { get: (headerName: string) => unknown }).get === 'function'
  ) {
    const value = (headers as { get: (headerName: string) => unknown }).get(name);
    return typeof value === 'string' ? value : undefined;
  }

  if (typeof headers === 'object' && headers !== null) {
    const record = headers as Record<string, unknown>;
    const direct = record[name] ?? record[name.toLowerCase()] ?? record[name.toUpperCase()];

    if (Array.isArray(direct)) {
      return typeof direct[0] === 'string' ? direct[0] : undefined;
    }

    return typeof direct === 'string' ? direct : undefined;
  }

  return undefined;
};

const resolveRetryAfterSeconds = (value: unknown, headers: unknown) =>
  parseRetryAfterSeconds(value)
  ?? parseRetryAfterSeconds(getHeaderValue(headers, 'retry-after'));

const unwrapEnvelope = <T>(response: AxiosResponse<T>): AxiosResponse<T> => {
  const payload = response.data;

  if (!isApiResponseEnvelope(payload)) {
    return response;
  }

  if (!payload.success) {
    throw createNormalizedApiError(
      payload.error?.message ?? DEFAULT_SERVER_ERROR_MESSAGE,
      {
        code: payload.error?.code,
        detail: payload.error?.detail ?? undefined,
        status: response.status,
        traceId: payload.traceId,
        operatorCode:
          typeof payload.error?.operatorCode === 'string'
            ? payload.error.operatorCode
            : undefined,
        retryAfterSeconds: resolveRetryAfterSeconds(
          payload.error?.retryAfterSeconds,
          response.headers,
        ),
        remainingAttempts: parseRemainingAttempts(payload.error?.remainingAttempts),
        enrollUrl:
          typeof payload.error?.enrollUrl === 'string'
            ? payload.error.enrollUrl
            : undefined,
        recoveryUrl:
          typeof payload.error?.recoveryUrl === 'string'
            ? payload.error.recoveryUrl
            : undefined,
        userMessageKey:
          typeof payload.error?.userMessageKey === 'string'
            ? payload.error.userMessageKey
            : undefined,
      },
    );
  }

  response.data = payload.data as T;
  return response;
};

export const normalizeApiError = (error: unknown): NormalizedApiError => {
  if (!axios.isAxiosError(error)) {
    return createNormalizedApiError(DEFAULT_SERVER_ERROR_MESSAGE);
  }

  const status = error.response?.status;
  const responseData = error.response?.data;

  if (isApiResponseEnvelope(responseData) && responseData.error) {
    return createNormalizedApiError(
      responseData.error.message || DEFAULT_SERVER_ERROR_MESSAGE,
      {
        code: responseData.error.code,
        detail: responseData.error.detail ?? undefined,
        status,
        traceId: responseData.traceId,
        operatorCode:
          typeof responseData.error.operatorCode === 'string'
            ? responseData.error.operatorCode
            : undefined,
        retryAfterSeconds: resolveRetryAfterSeconds(
          responseData.error.retryAfterSeconds,
          error.response?.headers,
        ),
        remainingAttempts: parseRemainingAttempts(responseData.error.remainingAttempts),
        enrollUrl:
          typeof responseData.error.enrollUrl === 'string'
            ? responseData.error.enrollUrl
            : undefined,
        recoveryUrl:
          typeof responseData.error.recoveryUrl === 'string'
            ? responseData.error.recoveryUrl
            : undefined,
        userMessageKey:
          typeof responseData.error.userMessageKey === 'string'
            ? responseData.error.userMessageKey
            : undefined,
      },
    );
  }

  if (isDirectApiErrorPayload(responseData)) {
    return createNormalizedApiError(
      responseData.message || DEFAULT_SERVER_ERROR_MESSAGE,
      {
        code: responseData.code,
        detail: responseData.path,
        status,
        traceId: responseData.correlationId,
        operatorCode:
          typeof responseData.operatorCode === 'string'
            ? responseData.operatorCode
            : undefined,
        retryAfterSeconds: resolveRetryAfterSeconds(
          responseData.retryAfterSeconds,
          error.response?.headers,
        ),
        remainingAttempts: parseRemainingAttempts(responseData.remainingAttempts),
        enrollUrl:
          typeof responseData.enrollUrl === 'string'
            ? responseData.enrollUrl
            : undefined,
        recoveryUrl:
          typeof responseData.recoveryUrl === 'string'
            ? responseData.recoveryUrl
            : undefined,
        userMessageKey:
          typeof responseData.userMessageKey === 'string'
            ? responseData.userMessageKey
            : undefined,
      },
    );
  }

  if (status === 403) {
    return createNormalizedApiError(FORBIDDEN_ERROR_MESSAGE, { status });
  }

  if (error.code === AxiosError.ECONNABORTED) {
    return createNormalizedApiError(TIMEOUT_ERROR_MESSAGE, { status });
  }

  if (!error.response) {
    return createNormalizedApiError(NETWORK_ERROR_MESSAGE, { status });
  }

  return createNormalizedApiError(DEFAULT_SERVER_ERROR_MESSAGE, { status });
};

const configuredBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim();
const resolvedBaseUrl = configuredBaseUrl && configuredBaseUrl.length > 0
  ? configuredBaseUrl
  : DEFAULT_BASE_URL;
const resolvedBaseUrlForParsing = /^https?:\/\//.test(resolvedBaseUrl)
  ? resolvedBaseUrl
  : 'http://localhost';

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

const isCsrfEndpoint = (url: string) => isAnyAuthEndpoint(url, ['/api/v1/auth/csrf']);

const resolvePathname = (url: string) => {
  return new URL(url, resolvedBaseUrlForParsing).pathname.replace(/\/+$/u, '');
};

const hasPathBoundary = (value: string, target: string) => {
  const index = value.indexOf(target);

  if (index === -1) {
    return false;
  }

  const boundaryIndex = index + target.length;
  const boundaryChar = value[boundaryIndex];

  return boundaryChar === undefined
    || boundaryChar === '/'
    || boundaryChar === '?'
    || boundaryChar === '#';
};

const isExactAuthEndpoint = (url: string, targetPath: string) => {
  const normalizedTarget = targetPath.replace(/\/+$/u, '');

  try {
    return resolvePathname(url) === normalizedTarget;
  } catch {
    return hasPathBoundary(url, targetPath);
  }
};

const isAuthEndpoint = (url: string, targetPath: string) => (
  isExactAuthEndpoint(url ?? '', targetPath)
);

const isAnyAuthEndpoint = (url: string, targetPaths: string[]) => (
  targetPaths.some((path) => isAuthEndpoint(url, path))
);

const isAuthChallengeEndpoint = (url?: string) => {
  if (!url) {
    return false;
  }

  return (
    isAuthEndpoint(url, '/api/v1/auth/login')
    || isAuthEndpoint(url, '/api/v1/auth/register')
  );
};

const shouldRetryCsrf = (config?: ApiRequestConfig) => {
  if (!config || config._csrfRetried || config._skipCsrf) {
    return false;
  }

  return shouldAttachCsrf(config) && !isCsrfEndpoint(config.url ?? '');
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
    .get<LenientApiResponseEnvelope<CsrfTokenPayload>>('/api/v1/auth/csrf')
    .then((response) => {
      const payload = response.data;

      if (!isApiResponseEnvelope(payload) || !payload.success || !payload.data) {
        throw createNormalizedApiError(DEFAULT_SERVER_ERROR_MESSAGE);
      }

      const resolvedToken =
        'csrfToken' in payload.data && typeof payload.data.csrfToken === 'string'
          ? payload.data.csrfToken
          : 'token' in payload.data && typeof payload.data.token === 'string'
            ? payload.data.token
            : null;

      if (!resolvedToken) {
        throw createNormalizedApiError(DEFAULT_SERVER_ERROR_MESSAGE);
      }

      csrfToken = resolvedToken;
      csrfHeaderName = payload.data.headerName || DEFAULT_CSRF_HEADER;

      return {
        csrfToken: resolvedToken,
        headerName: csrfHeaderName,
      };
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

  return !isAnyAuthEndpoint(url, [
    '/api/v1/auth/login',
    '/api/v1/auth/register',
    '/api/v1/auth/csrf',
    '/api/v1/auth/session',
  ]);
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

  try {
    const tokenPayload = await fetchCsrfToken();
    csrfHeaderName = tokenPayload.headerName || DEFAULT_CSRF_HEADER;
    csrfToken = tokenPayload.csrfToken;
    setCsrfHeader(request, tokenPayload.csrfToken);
    return request;
  } catch (error) {
    if (isAuthChallengeEndpoint(request.url)) {
      return request;
    }

    throw error;
  }
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
