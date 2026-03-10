import { useState } from 'react';

import {
  createLoginFieldErrors,
  validateLoginForm,
} from '@/lib/schemas/auth.schema';
import type { LoginRequest } from '@/types/auth';
import type { LoginFieldErrors } from '@/types/auth-ui';

export const useLoginFormState = () => {
  const [email, setEmail] = useState('');
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
    const validationResult = validateLoginForm({
      email,
      password,
    });

    setFieldErrors(validationResult.fieldErrors);

    return validationResult.message
      ? { message: validationResult.message }
      : null;
  };

  const getPayload = (): LoginRequest => ({
    email: email.trim(),
    password,
  });

  return {
    email,
    password,
    showPassword,
    fieldErrors,
    setEmail: (value: string) => {
      setEmail(value);
      clearFieldError('email');
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
