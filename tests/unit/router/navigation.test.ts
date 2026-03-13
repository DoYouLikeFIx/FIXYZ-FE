import {
  buildForgotPasswordPath,
  buildMfaRecoverySuccessLoginPath,
  buildPasswordResetSuccessLoginPath,
  buildResetPasswordPath,
} from '@/router/navigation';

describe('auth navigation helpers', () => {
  it('preserves protected redirects across forgot-password and reset-success paths', () => {
    expect(buildForgotPasswordPath('demo@fix.com', '/orders')).toBe(
      '/forgot-password?email=demo%40fix.com&redirect=%2Forders',
    );
    expect(buildResetPasswordPath(undefined, '/orders')).toBe(
      '/reset-password?redirect=%2Forders',
    );
    expect(buildPasswordResetSuccessLoginPath('/orders')).toBe(
      '/login?recovery=reset-success&redirect=%2Forders',
    );
    expect(buildMfaRecoverySuccessLoginPath('/orders')).toBe(
      '/login?mfaRecovery=rebound&redirect=%2Forders',
    );
  });
});
