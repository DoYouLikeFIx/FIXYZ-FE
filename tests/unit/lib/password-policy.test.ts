import {
  getPasswordPolicyChecks,
  isPasswordPolicySatisfied,
} from '@/lib/password-policy';

describe('password policy', () => {
  it('accepts passwords that satisfy the documented auth policy', () => {
    const checks = getPasswordPolicyChecks('Test1234!');

    expect(checks).toEqual({
      hasMinLength: true,
      hasUppercase: true,
      hasDigit: true,
      hasSpecial: true,
    });
    expect(isPasswordPolicySatisfied(checks)).toBe(true);
  });

  it('rejects passwords missing required categories', () => {
    const checks = getPasswordPolicyChecks('password');

    expect(checks.hasMinLength).toBe(true);
    expect(checks.hasUppercase).toBe(false);
    expect(checks.hasDigit).toBe(false);
    expect(checks.hasSpecial).toBe(false);
    expect(isPasswordPolicySatisfied(checks)).toBe(false);
  });
});
