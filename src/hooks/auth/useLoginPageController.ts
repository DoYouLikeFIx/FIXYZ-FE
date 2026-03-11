import { useState, type FormEventHandler } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { loginMember } from '@/api/authApi';
import { useAuthTabsNavigation } from '@/hooks/auth/useAuthTabsNavigation';
import { useLoginFormState } from '@/hooks/auth/useLoginFormState';
import type { AuthFrameControllerProps } from '@/hooks/auth/controllerTypes';
import { getAuthErrorMessage } from '@/lib/auth-errors';
import {
  buildForgotPasswordPath,
  hasPasswordResetSuccessQuery,
  resolveRedirectTarget,
} from '@/router/navigation';
import { useAuthStore } from '@/store/useAuthStore';

export const useLoginPageController = () => {
  const login = useAuthStore((state) => state.login);
  const reauthMessage = useAuthStore((state) => state.reauthMessage);
  const clearReauthMessage = useAuthStore((state) => state.clearReauthMessage);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const hasPasswordResetSuccess = hasPasswordResetSuccessQuery(searchParams);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPasswordRecoveryHelp, setShowPasswordRecoveryHelp] = useState(false);
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
    feedbackMessage: reauthMessage ?? (
      hasPasswordResetSuccess
        ? '비밀번호가 변경되었습니다. 새 비밀번호로 로그인해 주세요.'
        : null
    ),
    feedbackTone: 'info',
    feedbackTestId: reauthMessage
      ? 'reauth-guidance'
      : hasPasswordResetSuccess
        ? 'password-reset-success'
        : undefined,
    onLoginTabClick: handleTabNavigation('/login'),
    onRegisterTabClick: handleTabNavigation('/register'),
  };

  return {
    frameProps,
    formProps: {
      email: loginForm.email,
      password: loginForm.password,
      showPassword: loginForm.showPassword,
      emailInvalid: loginForm.fieldErrors.email,
      passwordInvalid: loginForm.fieldErrors.password,
      showPasswordRecoveryHelp,
      errorMessage,
      isSubmitting,
      forgotPasswordHref: buildForgotPasswordPath(loginForm.email),
      onEmailChange: (value: string) => {
        setErrorMessage(null);
        loginForm.setEmail(value);
      },
      onPasswordChange: (value: string) => {
        setErrorMessage(null);
        loginForm.setPassword(value);
      },
      onTogglePasswordVisibility: loginForm.togglePasswordVisibility,
      onTogglePasswordRecoveryHelp: () => {
        setShowPasswordRecoveryHelp((current) => !current);
      },
      onSubmit: handleSubmit,
    },
  };
};
