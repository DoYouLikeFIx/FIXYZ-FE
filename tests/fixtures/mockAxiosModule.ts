import type { AxiosAdapter, AxiosResponse } from 'axios';

export interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

export interface MockHttpResponse {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
  statusText?: string;
}

export const successEnvelope = <T,>(data: T): MockHttpResponse => ({
  status: 200,
  body: {
    success: true,
    data,
    error: null,
  },
});

export const failureEnvelope = (
  error: Record<string, unknown>,
  options?: {
    status?: number;
    headers?: Record<string, string>;
    traceId?: string;
  },
): MockHttpResponse => ({
  status: options?.status ?? 200,
  headers: options?.headers,
  body: {
    success: false,
    data: null,
    error,
    ...(options?.traceId
      ? {
          traceId: options.traceId,
        }
      : {}),
  },
});

const normalizeHeaders = (headers: unknown): Record<string, string> => {
  if (!headers) {
    return {};
  }

  if (
    typeof headers === 'object'
    && headers !== null
    && 'toJSON' in headers
    && typeof (headers as { toJSON: () => Record<string, string> }).toJSON === 'function'
  ) {
    return (headers as { toJSON: () => Record<string, string> }).toJSON();
  }

  return {
    ...(headers as Record<string, string>),
  };
};

const normalizeBody = (body: unknown): string | undefined => {
  if (typeof body === 'string') {
    return body;
  }

  if (body instanceof URLSearchParams) {
    return body.toString();
  }

  return body === undefined || body === null
    ? undefined
    : JSON.stringify(body);
};

export const getPathname = (url: string) => new URL(url, 'http://localhost').pathname;

export const installMockAxiosModule = async (
  handler: (request: RecordedCall) => Promise<MockHttpResponse> | MockHttpResponse,
) => {
  vi.resetModules();
  const actualAxios = await vi.importActual<typeof import('axios')>('axios');
  const calls: RecordedCall[] = [];

  const adapter: AxiosAdapter = async (config) => {
    const resolvedUrl = actualAxios.default.getUri({
      ...config,
      url: config.url ?? '/',
    });
    const request: RecordedCall = {
      url: resolvedUrl,
      method: (config.method ?? 'get').toUpperCase(),
      headers: normalizeHeaders(config.headers),
      body: normalizeBody(config.data),
    };

    calls.push(request);

    const response = await handler(request);
    const axiosResponse = {
      data: response.body,
      status: response.status,
      statusText: response.statusText ?? 'OK',
      headers: response.headers ?? {},
      config,
    } as AxiosResponse;

    if (response.status >= 400) {
      throw new actualAxios.AxiosError(
        `Request failed with status code ${response.status}`,
        'ERR_BAD_REQUEST',
        config,
        undefined,
        axiosResponse,
      );
    }

    return axiosResponse;
  };

  vi.doMock('axios', async () => ({
    ...actualAxios,
    default: {
      ...actualAxios.default,
      create: (config?: Record<string, unknown>) =>
        actualAxios.default.create({
          ...(config ?? {}),
          adapter,
        }),
      isAxiosError: actualAxios.default.isAxiosError,
    },
  }));

  return {
    calls,
    restore: () => {
      vi.doUnmock('axios');
      vi.restoreAllMocks();
    },
  };
};
