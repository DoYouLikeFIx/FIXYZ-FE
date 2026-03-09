import { useState } from 'react';

import {
  createRegisterFieldErrors,
  getRegisterPasswordState,
  validateRegisterForm,
} from '@/lib/schemas/auth.schema';
import type { RegisterRequest } from '@/types/auth';
import type { RegisterFieldErrors } from '@/types/auth-ui';

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

  const {
    isPasswordValid,
    isConfirmDirty,
    isConfirmPasswordValid,
    passwordPolicyMessage,
    confirmPasswordMessage,
  } = getRegisterPasswordState(password, confirmPassword);

  const clearFieldError = (field: keyof RegisterFieldErrors) => {
    setFieldErrors((current) =>
      current[field] ? { ...current, [field]: false } : current,
    );
  };

  const validate = (): { message: string } | null => {
    const validationResult = validateRegisterForm({
      username,
      email,
      name,
      password,
      confirmPassword,
    });

    setFieldErrors(validationResult.fieldErrors);

    return validationResult.message
      ? { message: validationResult.message }
      : null;
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
