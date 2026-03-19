import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import {
  getPathname,
  installMockAxiosModule,
  successEnvelope,
} from '../fixtures/mockAxiosModule';

class MockEventSource {
  close() {}

  addEventListener() {}

  removeEventListener() {}
}

describe.sequential('App auth transport coverage', () => {
  beforeAll(() => {
    vi.stubGlobal('EventSource', MockEventSource);
  });

  afterEach(() => {
    cleanup();
    vi.doUnmock('axios');
    vi.restoreAllMocks();
  });

  it('shows a visible support reference from a header-derived correlation id through the real auth transport', async () => {
    const transport = await installMockAxiosModule((request) => {
      if (request.method === 'GET' && getPathname(request.url) === '/api/v1/auth/session') {
        return {
          status: 401,
          body: {
            code: 'AUTH-003',
            message: 'authentication required',
            path: '/api/v1/auth/session',
            timestamp: '2026-03-19T00:00:00Z',
          },
        };
      }

      if (request.method === 'GET' && getPathname(request.url) === '/api/v1/auth/csrf') {
        return successEnvelope({
          token: 'csrf-auth-transport-001',
        });
      }

      if (request.method === 'POST' && getPathname(request.url) === '/api/v1/auth/login') {
        return {
          status: 500,
          headers: {
            'x-correlation-id': 'corr-auth-transport-001, corr-proxy-ignored',
            traceparent:
              '00-1234567890abcdef1234567890abcdef-1234567890abcdef-01',
          },
          body: {
            code: 'AUTH-999',
            message: 'Raw backend detail that should not leak',
            path: '/api/v1/auth/login',
            timestamp: '2026-03-19T00:00:00Z',
          },
        };
      }

      throw new Error(`Unhandled request: ${request.method} ${request.url}`);
    });
    const authStore = await import('@/store/useAuthStore');
    const { default: App } = await import('@/App');
    authStore.resetAuthStore();
    window.history.pushState({}, '', '/login');

    const user = userEvent.setup();
    render(<App />);

    await user.type(await screen.findByTestId('login-email'), 'demo@fix.com');
    await user.type(screen.getByTestId('login-password'), 'WrongPass1!');
    await user.click(screen.getByTestId('login-submit'));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '로그인을 완료할 수 없습니다. 잠시 후 다시 시도해 주세요. 문제가 계속되면 고객센터에 문의해 주세요. 문의 코드: corr-auth-transport-001',
    );

    const loginCall = transport.calls.find(
      (call) => call.method === 'POST' && getPathname(call.url) === '/api/v1/auth/login',
    );

    expect(loginCall?.headers['X-CSRF-TOKEN']).toBe('csrf-auth-transport-001');
    expect(loginCall?.body).toBe('email=demo%40fix.com&password=WrongPass1%21');
  });

  it('renders reset-token guidance through the real password-reset transport path', async () => {
    const transport = await installMockAxiosModule((request) => {
      if (request.method === 'GET' && getPathname(request.url) === '/api/v1/auth/session') {
        return {
          status: 401,
          body: {
            code: 'AUTH-003',
            message: 'authentication required',
            path: '/api/v1/auth/session',
            timestamp: '2026-03-19T00:00:00Z',
          },
        };
      }

      if (request.method === 'GET' && getPathname(request.url) === '/api/v1/auth/csrf') {
        return successEnvelope({
          token: 'csrf-reset-transport-001',
        });
      }

      if (request.method === 'POST' && getPathname(request.url) === '/api/v1/auth/password/reset') {
        return {
          status: 401,
          headers: {
            'x-correlation-id': 'corr-reset-transport-001',
          },
          body: {
            code: 'AUTH-012',
            message: 'reset token invalid or expired',
            path: '/api/v1/auth/password/reset',
            timestamp: '2026-03-19T00:00:00Z',
          },
        };
      }

      throw new Error(`Unhandled request: ${request.method} ${request.url}`);
    });
    const authStore = await import('@/store/useAuthStore');
    const { default: App } = await import('@/App');
    authStore.resetAuthStore();
    window.history.pushState({}, '', '/reset-password?token=stale-reset-token');

    const user = userEvent.setup();
    render(<App />);

    await user.type(
      await screen.findByTestId('reset-password-new-password'),
      'FreshPass1!',
    );
    await user.click(screen.getByTestId('reset-password-submit'));

    expect(await screen.findByTestId('reset-password-error')).toHaveTextContent(
      '재설정 링크가 유효하지 않거나 만료되었습니다. 비밀번호 재설정을 다시 요청해 주세요.',
    );

    const resetCall = transport.calls.find(
      (call) =>
        call.method === 'POST' && getPathname(call.url) === '/api/v1/auth/password/reset',
    );

    expect(resetCall?.headers['X-CSRF-TOKEN']).toBe('csrf-reset-transport-001');
    expect(resetCall?.body).toBe(
      JSON.stringify({
        token: 'stale-reset-token',
        newPassword: 'FreshPass1!',
      }),
    );
  });
});
