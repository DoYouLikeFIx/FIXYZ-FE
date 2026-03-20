import { z } from 'zod';

import {
  getPasswordPolicyChecks,
  isPasswordPolicySatisfied,
} from '@/lib/password-policy';
import type { RegisterFieldErrors } from '@/types/auth-ui';

const PASSWORD_POLICY_GUIDANCE = '8자 이상, 대문자, 숫자, 특수문자를 포함해 주세요.';
const PASSWORD_POLICY_ERROR = '비밀번호 정책을 모두 충족해 주세요.';

export interface RegisterFormValues {
  email: string;
  password: string;
  name: string;
  confirmPassword: string;
}

export interface RegisterPasswordState {
  isPasswordValid: boolean;
  isConfirmDirty: boolean;
  isConfirmPasswordValid: boolean;
  passwordPolicyMessage: string;
  confirmPasswordMessage: string;
}

const emailSchema = z.string()
  .trim()
  .min(1, '이메일을 입력해 주세요.')
  .email('올바른 이메일 형식을 입력해 주세요.');

const requiredPasswordSchema = z.string().min(1, '비밀번호를 입력해 주세요.');

const otpCodeSchema = z.string()
  .min(1, '인증 코드를 입력해 주세요.')
  .regex(/^\d{6}$/, '인증 코드는 숫자 6자리로 입력해 주세요.');

export const loginSchema = z.object({
  email: emailSchema,
  password: requiredPasswordSchema,
});

export type LoginFormValues = z.infer<typeof loginSchema>;

export const loginMfaSchema = z.object({
  otpCode: otpCodeSchema,
});

export type LoginMfaFormValues = z.infer<typeof loginMfaSchema>;

export const createRegisterFieldErrors = (): RegisterFieldErrors => ({
  email: false,
  name: false,
  password: false,
  confirmPassword: false,
});

export const forgotPasswordSchema = z.object({
  email: emailSchema,
  challengeAnswer: z.string(),
  requiresChallenge: z.boolean(),
}).superRefine(({ challengeAnswer, requiresChallenge }, context) => {
  if (!requiresChallenge) {
    return;
  }

  if (!challengeAnswer.trim()) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['challengeAnswer'],
      message: '보안 확인 응답을 입력해 주세요.',
    });
  }
});

export type ForgotPasswordFormValues = z.infer<typeof forgotPasswordSchema>;

export const getRegisterPasswordState = (
  password: string,
  confirmPassword: string,
): RegisterPasswordState => {
  const passwordChecks = getPasswordPolicyChecks(password);
  const isPasswordValid = isPasswordPolicySatisfied(passwordChecks);
  const isConfirmDirty = confirmPassword.length > 0;
  const isConfirmPasswordValid = isConfirmDirty && password === confirmPassword;

  return {
    isPasswordValid,
    isConfirmDirty,
    isConfirmPasswordValid,
    passwordPolicyMessage: isPasswordValid
      ? '사용 가능한 비밀번호 형식입니다.'
      : PASSWORD_POLICY_GUIDANCE,
    confirmPasswordMessage: isConfirmDirty
      ? isConfirmPasswordValid
        ? '비밀번호가 일치합니다.'
        : '비밀번호 확인이 일치하지 않습니다.'
      : '비밀번호 확인을 입력해 주세요.',
  };
};

export const getResetPasswordState = (password: string) => {
  const passwordChecks = getPasswordPolicyChecks(password);
  const isPasswordValid = isPasswordPolicySatisfied(passwordChecks);

  return {
    isPasswordValid,
    passwordPolicyMessage: isPasswordValid
      ? '사용 가능한 비밀번호 형식입니다.'
      : PASSWORD_POLICY_GUIDANCE,
  };
};

export const resetPasswordSchema = z.object({
  newPassword: z.string()
    .min(1, '새 비밀번호를 입력해 주세요.')
    .refine((value) => getResetPasswordState(value).isPasswordValid, PASSWORD_POLICY_ERROR),
});

export type ResetPasswordFormValues = z.infer<typeof resetPasswordSchema>;

export const mfaRecoveryEntrySchema = z.object({
  currentPassword: z.string().min(1, '현재 비밀번호를 입력해 주세요.'),
});

export type MfaRecoveryEntryFormValues = z.infer<typeof mfaRecoveryEntrySchema>;

export const mfaRecoveryRebindSchema = z.object({
  otpCode: otpCodeSchema,
});

export type MfaRecoveryRebindFormValues = z.infer<typeof mfaRecoveryRebindSchema>;

export const validateRegisterForm = ({
  email,
  name,
  password,
  confirmPassword,
}: RegisterFormValues): {
  fieldErrors: RegisterFieldErrors;
  message: string | null;
} => {
  const fieldErrors = createRegisterFieldErrors();
  const passwordState = getRegisterPasswordState(password, confirmPassword);

  const normalizedEmail = email.trim();

  if (!normalizedEmail) {
    fieldErrors.email = true;

    return {
      fieldErrors,
      message: '이메일을 입력해 주세요.',
    };
  }

  if (!emailSchema.safeParse(normalizedEmail).success) {
    fieldErrors.email = true;

    return {
      fieldErrors,
      message: '올바른 이메일 형식을 입력해 주세요.',
    };
  }

  if (!name.trim()) {
    fieldErrors.name = true;

    return {
      fieldErrors,
      message: '이름을 입력해 주세요.',
    };
  }

  if (!password || !passwordState.isPasswordValid) {
    fieldErrors.password = true;

    return {
      fieldErrors,
      message: !password
        ? '비밀번호를 입력해 주세요.'
        : PASSWORD_POLICY_ERROR,
    };
  }

  if (!confirmPassword || !passwordState.isConfirmPasswordValid) {
    fieldErrors.confirmPassword = true;

    return {
      fieldErrors,
      message: !confirmPassword
        ? '비밀번호 확인을 입력해 주세요.'
        : '비밀번호 확인이 일치하지 않습니다.',
    };
  }

  return {
    fieldErrors,
    message: null,
  };
};
