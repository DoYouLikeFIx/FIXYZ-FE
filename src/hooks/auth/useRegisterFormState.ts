import { useState } from 'react';

import {
  getPasswordPolicyChecks,
  isPasswordPolicySatisfied,
} from '@/lib/password-policy';
import type { RegisterRequest } from '@/types/auth';
import type { RegisterFieldErrors } from '@/types/auth-ui';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const createRegisterFieldErrors = (): RegisterFieldErrors => ({
  username: false,
  email: false,
  name: false,
  password: false,
  confirmPassword: false,
});

export const useRegisterFormState = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<RegisterFieldErrors>(
    createRegisterFieldErrors,
  );

  const passwordChecks = getPasswordPolicyChecks(password);
  const isPasswordValid = isPasswordPolicySatisfied(passwordChecks);
  const isConfirmDirty = confirmPassword.length > 0;
  const isConfirmPasswordValid = isConfirmDirty && password === confirmPassword;
  const passwordPolicyMessage = isPasswordValid
    ? '사용 가능한 비밀번호 형식입니다.'
    : '8자 이상, 대문자, 숫자, 특수문자를 포함해 주세요.';
  const confirmPasswordMessage = isConfirmDirty
    ? isConfirmPasswordValid
      ? '비밀번호가 일치합니다.'
      : '비밀번호 확인이 일치하지 않습니다.'
    : '비밀번호 확인을 입력해 주세요.';

  const clearFieldError = (field: keyof RegisterFieldErrors) => {
    setFieldErrors((current) =>
      current[field] ? { ...current, [field]: false } : current,
    );
  };

  const validate = (): { message: string } | null => {
    const nextFieldErrors: RegisterFieldErrors = createRegisterFieldErrors();

    if (!username.trim()) {
      nextFieldErrors.username = true;
      setFieldErrors(nextFieldErrors);
      return { message: '아이디를 입력해 주세요.' };
    }

    if (!email.trim() || !EMAIL_PATTERN.test(email.trim())) {
      nextFieldErrors.email = true;
      setFieldErrors(nextFieldErrors);
      return {
        message: !email.trim()
          ? '이메일을 입력해 주세요.'
          : '올바른 이메일 형식을 입력해 주세요.',
      };
    }

    if (!name.trim()) {
      nextFieldErrors.name = true;
      setFieldErrors(nextFieldErrors);
      return { message: '이름을 입력해 주세요.' };
    }

    if (!password || !isPasswordValid) {
      nextFieldErrors.password = true;
      setFieldErrors(nextFieldErrors);
      return {
        message: !password
          ? '비밀번호를 입력해 주세요.'
          : '비밀번호 정책을 모두 충족해 주세요.',
      };
    }

    if (!confirmPassword || !isConfirmPasswordValid) {
      nextFieldErrors.confirmPassword = true;
      setFieldErrors(nextFieldErrors);
      return {
        message: !confirmPassword
          ? '비밀번호 확인을 입력해 주세요.'
          : '비밀번호 확인이 일치하지 않습니다.',
      };
    }

    setFieldErrors(nextFieldErrors);
    return null;
  };

  const getPayload = (): RegisterRequest => ({
    username: username.trim(),
    password,
    email: email.trim(),
    name: name.trim(),
  });

  return {
    username,
    email,
    name,
    password,
    confirmPassword,
    showPassword,
    showConfirmPassword,
    fieldErrors,
    isPasswordValid,
    isConfirmDirty,
    isConfirmPasswordValid,
    passwordPolicyMessage,
    confirmPasswordMessage,
    setUsername: (value: string) => {
      setUsername(value);
      clearFieldError('username');
    },
    setEmail: (value: string) => {
      setEmail(value);
      clearFieldError('email');
    },
    setName: (value: string) => {
      setName(value);
      clearFieldError('name');
    },
    setPassword: (value: string) => {
      setPassword(value);
      clearFieldError('password');
    },
    setConfirmPassword: (value: string) => {
      setConfirmPassword(value);
      clearFieldError('confirmPassword');
    },
    togglePasswordVisibility: () => setShowPassword((current) => !current),
    toggleConfirmPasswordVisibility: () =>
      setShowConfirmPassword((current) => !current),
    validate,
    getPayload,
  };
};
