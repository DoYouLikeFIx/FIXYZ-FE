import {
  getPasswordPolicyChecks,
  isPasswordPolicySatisfied,
} from '@/lib/password-policy';
import type { LoginFieldErrors, RegisterFieldErrors } from '@/types/auth-ui';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface LoginFormValues {
  email: string;
  password: string;
}

export interface RegisterFormValues {
  email: string;
  password: string;
  name: string;
  confirmPassword: string;
}

export interface ValidationResult<TFieldErrors> {
  fieldErrors: TFieldErrors;
  message: string | null;
}

export interface RegisterPasswordState {
  isPasswordValid: boolean;
  isConfirmDirty: boolean;
  isConfirmPasswordValid: boolean;
  passwordPolicyMessage: string;
  confirmPasswordMessage: string;
}

export interface ForgotPasswordFieldErrors {
  email: boolean;
  challengeAnswer: boolean;
}

export interface ResetPasswordFieldErrors {
  newPassword: boolean;
}

export const createLoginFieldErrors = (): LoginFieldErrors => ({
  email: false,
  password: false,
});

export const createRegisterFieldErrors = (): RegisterFieldErrors => ({
  email: false,
  name: false,
  password: false,
  confirmPassword: false,
});

export const createForgotPasswordFieldErrors = (): ForgotPasswordFieldErrors => ({
  email: false,
  challengeAnswer: false,
});

export const createResetPasswordFieldErrors = (): ResetPasswordFieldErrors => ({
  newPassword: false,
});

export const validateLoginForm = ({
  email,
  password,
}: LoginFormValues): ValidationResult<LoginFieldErrors> => {
  const fieldErrors: LoginFieldErrors = {
    email: !email.trim() || !EMAIL_PATTERN.test(email.trim()),
    password: !password,
  };

  if (fieldErrors.email) {
    return {
      fieldErrors,
      message: !email.trim()
        ? '이메일을 입력해 주세요.'
        : '올바른 이메일 형식을 입력해 주세요.',
    };
  }

  if (fieldErrors.password) {
    return {
      fieldErrors,
      message: '비밀번호를 입력해 주세요.',
    };
  }

  return {
    fieldErrors,
    message: null,
  };
};

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
      : '8자 이상, 대문자, 숫자, 특수문자를 포함해 주세요.',
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
      : '8자 이상, 대문자, 숫자, 특수문자를 포함해 주세요.',
  };
};

export const validateForgotPasswordForm = ({
  email,
  requiresChallenge,
  challengeAnswer,
}: {
  email: string;
  requiresChallenge?: boolean;
  challengeAnswer?: string;
}): ValidationResult<ForgotPasswordFieldErrors> => {
  const fieldErrors = createForgotPasswordFieldErrors();

  if (!email.trim() || !EMAIL_PATTERN.test(email.trim())) {
    fieldErrors.email = true;

    return {
      fieldErrors,
      message: !email.trim()
        ? '이메일을 입력해 주세요.'
        : '올바른 이메일 형식을 입력해 주세요.',
    };
  }

  if (requiresChallenge && !challengeAnswer?.trim()) {
    fieldErrors.challengeAnswer = true;

    return {
      fieldErrors,
      message: '보안 확인 응답을 입력해 주세요.',
    };
  }

  return {
    fieldErrors,
    message: null,
  };
};

export const validateResetPasswordForm = ({
  newPassword,
}: {
  newPassword: string;
}): ValidationResult<ResetPasswordFieldErrors> => {
  const fieldErrors = createResetPasswordFieldErrors();
  const passwordState = getResetPasswordState(newPassword);

  if (!newPassword) {
    fieldErrors.newPassword = true;

    return {
      fieldErrors,
      message: '새 비밀번호를 입력해 주세요.',
    };
  }

  if (!passwordState.isPasswordValid) {
    fieldErrors.newPassword = true;

    return {
      fieldErrors,
      message: '비밀번호 정책을 모두 충족해 주세요.',
    };
  }

  return {
    fieldErrors,
    message: null,
  };
};

export const validateRegisterForm = ({
  email,
  name,
  password,
  confirmPassword,
}: RegisterFormValues): ValidationResult<RegisterFieldErrors> => {
  const fieldErrors = createRegisterFieldErrors();
  const passwordState = getRegisterPasswordState(password, confirmPassword);

  if (!email.trim() || !EMAIL_PATTERN.test(email.trim())) {
    fieldErrors.email = true;

    return {
      fieldErrors,
      message: !email.trim()
        ? '이메일을 입력해 주세요.'
        : '올바른 이메일 형식을 입력해 주세요.',
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
        : '비밀번호 정책을 모두 충족해 주세요.',
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
