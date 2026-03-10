import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';

import { resetPassword } from '@/api/authApi';
import { useAuthTabsNavigation } from '@/hooks/auth/useAuthTabsNavigation';
import type { AuthFrameControllerProps } from '@/hooks/auth/controllerTypes';
import { resolveAuthErrorPresentation } from '@/lib/auth-errors';
import {
  createResetPasswordFieldErrors,
  getResetPasswordState,
  validateResetPasswordForm,
} from '@/lib/schemas/auth.schema';
import {
  buildPasswordResetSuccessLoginPath,
  buildResetPasswordPath,
} from '@/router/navigation';
import { useAuthStore } from '@/store/useAuthStore';

interface ResetPasswordLocationState {
  resetToken?: string;
}

const getLocationStateToken = (state: unknown) => {
  if (!state || typeof state !== 'object') {
    return '';
  }

  const candidate = state as ResetPasswordLocationState;
  return typeof candidate.resetToken === 'string' ? candidate.resetToken : '';
};

export const useResetPasswordPageController = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const queryToken = searchParams.get('token')?.trim() ?? '';
  const stateToken = getLocationStateToken(location.state).trim();
  const [newPassword, setNewPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [fieldErrors, setFieldErrors] = useState(createResetPasswordFieldErrors);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const requireReauth = useAuthStore((state) => state.requireReauth);
  const resetToken = (queryToken || stateToken).trim();
  const { displayMode, handleTabNavigation } = useAuthTabsNavigation('login');
  const { isPasswordValid, passwordPolicyMessage } = getResetPasswordState(newPassword);

  useEffect(() => {
    if (!queryToken) {
      return;
    }

    navigate(buildResetPasswordPath(), {
      replace: true,
      state: {
        resetToken: queryToken,
      },
    });
  }, [navigate, queryToken]);

  const frameProps: AuthFrameControllerProps = useMemo(() => ({
    displayMode,
    onLoginTabClick: handleTabNavigation('/login'),
    onRegisterTabClick: handleTabNavigation('/register'),
  }), [displayMode, handleTabNavigation]);

  const handleSubmit = async () => {
    setErrorMessage(null);

    if (!resetToken) {
      setErrorMessage('재설정 링크가 유효하지 않거나 만료되었습니다. 비밀번호 재설정을 다시 요청해 주세요.');
      return;
    }

    const validation = validateResetPasswordForm({
      newPassword,
    });

    setFieldErrors(validation.fieldErrors);

    if (validation.message) {
      setErrorMessage(validation.message);
      return;
    }

    setIsSubmitting(true);

    try {
      await resetPassword({
        token: resetToken,
        newPassword,
      });

      navigate(buildPasswordResetSuccessLoginPath(), {
        replace: true,
      });
    } catch (error) {
      const presentation = resolveAuthErrorPresentation(error);

      if (presentation.semantic === 'reauth-required') {
        requireReauth(presentation.message);
        navigate('/login', {
          replace: true,
        });
        return;
      }

      setErrorMessage(presentation.message);
      setFieldErrors({
        newPassword: presentation.recoveryAction === 'fix-password',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return {
    frameProps,
    formProps: {
      hasToken: Boolean(resetToken),
      newPassword,
      showPassword,
      passwordInvalid: fieldErrors.newPassword,
      passwordPolicyMessage,
      errorMessage,
      isSubmitting,
      onPasswordChange: (value: string) => {
        setNewPassword(value);
        setFieldErrors(createResetPasswordFieldErrors());
        setErrorMessage(null);
      },
      onTogglePasswordVisibility: () => {
        setShowPassword((current) => !current);
      },
      onSubmit: handleSubmit,
    },
    isPasswordValid,
  };
};
