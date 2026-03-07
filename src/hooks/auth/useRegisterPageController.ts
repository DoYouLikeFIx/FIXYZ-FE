import { useState, type FormEventHandler } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { loginMember, registerMember } from '@/api/authApi';
import { useAuthTabsNavigation } from '@/hooks/auth/useAuthTabsNavigation';
import { useRegisterFormState } from '@/hooks/auth/useRegisterFormState';
import type { AuthFrameControllerProps } from '@/hooks/auth/controllerTypes';
import { getAuthErrorMessage } from '@/lib/auth-errors';
import { resolveRedirectTarget } from '@/router/navigation';
import { useAuthStore } from '@/store/useAuthStore';

export const useRegisterPageController = () => {
  const login = useAuthStore((state) => state.login);
  const clearReauthMessage = useAuthStore((state) => state.clearReauthMessage);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const registerForm = useRegisterFormState();
  const { displayMode, handleTabNavigation } = useAuthTabsNavigation('register');

  const handleSubmit: FormEventHandler<HTMLFormElement> = async (event) => {
    event.preventDefault();
    setErrorMessage(null);
    clearReauthMessage();

    const validationResult = registerForm.validate();

    if (validationResult) {
      setErrorMessage(validationResult.message);
      return;
    }

    setIsSubmitting(true);

    try {
      const registrationPayload = registerForm.getPayload();

      await registerMember(registrationPayload);

      const member = await loginMember({
        username: registrationPayload.username,
        password: registrationPayload.password,
      });

      login(member);
      navigate(resolveRedirectTarget(searchParams.get('redirect')), {
        replace: true,
      });
    } catch (error) {
      setErrorMessage(getAuthErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  };

  const frameProps: AuthFrameControllerProps = {
    displayMode,
    onLoginTabClick: handleTabNavigation('/login'),
    onRegisterTabClick: handleTabNavigation('/register'),
  };

  return {
    frameProps,
    formProps: {
      username: registerForm.username,
      email: registerForm.email,
      name: registerForm.name,
      password: registerForm.password,
      confirmPassword: registerForm.confirmPassword,
      showPassword: registerForm.showPassword,
      showConfirmPassword: registerForm.showConfirmPassword,
      usernameInvalid: registerForm.fieldErrors.username,
      emailInvalid: registerForm.fieldErrors.email,
      nameInvalid: registerForm.fieldErrors.name,
      passwordInvalid: registerForm.fieldErrors.password,
      confirmPasswordInvalid: registerForm.fieldErrors.confirmPassword,
      isPasswordValid: registerForm.isPasswordValid,
      isConfirmDirty: registerForm.isConfirmDirty,
      isConfirmPasswordValid: registerForm.isConfirmPasswordValid,
      passwordPolicyMessage: registerForm.passwordPolicyMessage,
      confirmPasswordMessage: registerForm.confirmPasswordMessage,
      errorMessage,
      isSubmitting,
      onUsernameChange: (value: string) => {
        setErrorMessage(null);
        registerForm.setUsername(value);
      },
      onEmailChange: (value: string) => {
        setErrorMessage(null);
        registerForm.setEmail(value);
      },
      onNameChange: (value: string) => {
        setErrorMessage(null);
        registerForm.setName(value);
      },
      onPasswordChange: (value: string) => {
        setErrorMessage(null);
        registerForm.setPassword(value);
      },
      onConfirmPasswordChange: (value: string) => {
        setErrorMessage(null);
        registerForm.setConfirmPassword(value);
      },
      onTogglePasswordVisibility: registerForm.togglePasswordVisibility,
      onToggleConfirmPasswordVisibility:
        registerForm.toggleConfirmPasswordVisibility,
      onSubmit: handleSubmit,
    },
  };
};
