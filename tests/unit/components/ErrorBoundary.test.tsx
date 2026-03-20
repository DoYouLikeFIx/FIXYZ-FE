import { AxiosError } from 'axios';
import { render, screen } from '@testing-library/react';

import { ErrorBoundary } from '@/components/common/ErrorBoundary';
import {
  getApiErrorDiagnosticLog,
  normalizeApiError,
} from '@/lib/axios';

const createNormalizedApiError = () =>
  normalizeApiError(
    new AxiosError('Request failed', 'ERR_BAD_REQUEST', undefined, undefined, {
      config: {} as never,
      data: {
        code: 'AUTH-999',
        message: 'Raw backend details should not leak into diagnostics',
        path: '/api/v1/auth/login',
        detail: 'sensitive@example.com requested reset',
        timestamp: '2026-03-19T00:00:00Z',
      },
      headers: {
        'x-correlation-id': 'corr-boundary-001',
      },
      status: 500,
      statusText: 'Internal Server Error',
    }),
  );

const ThrowError = ({ error }: { error: Error }) => {
  throw error;
};

describe('ErrorBoundary', () => {
  it('logs only the safe api diagnostic context for normalized api errors', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const error = createNormalizedApiError();

    render(
      <ErrorBoundary>
        <ThrowError error={error} />
      </ErrorBoundary>,
    );

    expect(await screen.findByRole('alert')).toBeInTheDocument();

    const reviewLogCall = consoleSpy.mock.calls.find(
      ([firstArg]) => firstArg === 'Unhandled React error',
    );
    const loggedContext = reviewLogCall?.[1] as Record<string, unknown> | undefined;

    expect(loggedContext).toEqual(getApiErrorDiagnosticLog(error));
    expect(loggedContext).toMatchObject({
      code: 'AUTH-999',
      status: 500,
      traceId: 'corr-boundary-001',
      operatorCode: undefined,
      retryAfterSeconds: undefined,
      remainingAttempts: undefined,
      userMessageKey: undefined,
    });
    expect(loggedContext?.stackFrames).toEqual(expect.any(Array));
    expect(loggedContext).not.toHaveProperty('message');
    expect(loggedContext).not.toHaveProperty('detail');

    consoleSpy.mockRestore();
  });
});
