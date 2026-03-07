import { useState } from 'react';

import type { LoginRequest } from '@/types/auth';
import type { LoginFieldErrors } from '@/types/auth-ui';

const createLoginFieldErrors = (): LoginFieldErrors => ({
  username: false,
  password: false,
});

export const useLoginFormState = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<LoginFieldErrors>(
    createLoginFieldErrors,
  );

  const clearFieldError = (field: keyof LoginFieldErrors) => {
    setFieldErrors((current) =>
      current[field] ? { ...current, [field]: false } : current,
    );
  };

  const validate = (): { message: string } | null => {
    const nextFieldErrors: LoginFieldErrors = {
      username: !username.trim(),
      password: !password,
    };

    setFieldErrors(nextFieldErrors);

    if (nextFieldErrors.username) {
      return { message: '아이디를 입력해 주세요.' };
    }

    if (nextFieldErrors.password) {
      return { message: '비밀번호를 입력해 주세요.' };
    }

    return null;
  };

  const getPayload = (): LoginRequest => ({
    username: username.trim(),
    password,
  });

  return {
    username,
    password,
    showPassword,
    fieldErrors,
    setUsername: (value: string) => {
      setUsername(value);
      clearFieldError('username');
    },
    setPassword: (value: string) => {
      setPassword(value);
      clearFieldError('password');
    },
    togglePasswordVisibility: () => setShowPassword((current) => !current),
    validate,
    getPayload,
  };
};
