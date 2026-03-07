import { useState, type FormEventHandler } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { loginMember } from '@/api/authApi';
import { useAuthTabsNavigation } from '@/hooks/auth/useAuthTabsNavigation';
import { useLoginFormState } from '@/hooks/auth/useLoginFormState';
import type { AuthFrameControllerProps } from '@/hooks/auth/controllerTypes';
import { getAuthErrorMessage } from '@/lib/auth-errors';
import { resolveRedirectTarget } from '@/router/navigation';
import { useAuthStore } from '@/store/useAuthStore';

export const useLoginPageController = () => {
  const login = useAuthStore((state) => state.login);
  const reauthMessage = useAuthStore((state) => state.reauthMessage);
  const clearReauthMessage = useAuthStore((state) => state.clearReauthMessage);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const loginForm = useLoginFormState();
  const { displayMode, handleTabNavigation } = useAuthTabsNavigation('login');

  const handleSubmit: FormEventHandler<HTMLFormElement> = async (event) => {
    event.preventDefault();
    setErrorMessage(null);
    clearReauthMessage();

    const validationResult = loginForm.validate();

    if (validationResult) {
      setErrorMessage(validationResult.message);
      return;
    }

    setIsSubmitting(true);

    try {
      const member = await loginMember(loginForm.getPayload());
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
    feedbackMessage: reauthMessage,
    feedbackTone: 'info',
    feedbackTestId: reauthMessage ? 'reauth-guidance' : undefined,
    onLoginTabClick: handleTabNavigation('/login'),
    onRegisterTabClick: handleTabNavigation('/register'),
  };

  return {
    frameProps,
    formProps: {
      username: loginForm.username,
      password: loginForm.password,
      showPassword: loginForm.showPassword,
      usernameInvalid: loginForm.fieldErrors.username,
      passwordInvalid: loginForm.fieldErrors.password,
      errorMessage,
      isSubmitting,
      onUsernameChange: (value: string) => {
        setErrorMessage(null);
        loginForm.setUsername(value);
      },
      onPasswordChange: (value: string) => {
        setErrorMessage(null);
        loginForm.setPassword(value);
      },
      onTogglePasswordVisibility: loginForm.togglePasswordVisibility,
      onSubmit: handleSubmit,
    },
  };
};
