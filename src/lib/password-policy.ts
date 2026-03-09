export interface PasswordPolicyChecks {
  hasMinLength: boolean;
  hasUppercase: boolean;
  hasDigit: boolean;
  hasSpecial: boolean;
}

export const getPasswordPolicyChecks = (
  password: string,
): PasswordPolicyChecks => ({
  hasMinLength: password.length >= 8,
  hasUppercase: /[A-Z]/.test(password),
  hasDigit: /\d/.test(password),
  hasSpecial: /[^A-Za-z0-9]/.test(password),
});

export const isPasswordPolicySatisfied = (checks: PasswordPolicyChecks) =>
  Object.values(checks).every(Boolean);
