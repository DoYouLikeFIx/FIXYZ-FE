import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { zodResolver } from '@hookform/resolvers/zod';
import { useController, useForm } from 'react-hook-form';

import { resetPassword } from '@/api/authApi';
import { useAuthTabsNavigation } from '@/hooks/auth/useAuthTabsNavigation';
import type { AuthFrameControllerProps } from '@/hooks/auth/controllerTypes';
import { resolveAuthErrorPresentation } from '@/lib/auth-errors';
import {
  getResetPasswordState,
  resetPasswordSchema,
  type ResetPasswordFormValues,
} from '@/lib/schemas/auth.schema';
import {
  buildLoginRedirect,
  buildMfaRecoveryPath,
  buildPasswordResetSuccessLoginPath,
  buildResetPasswordPath,
  resolveRedirectTarget,
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
  const redirectPath = searchParams.get('redirect')
    ? resolveRedirectTarget(searchParams.get('redirect'))
    : undefined;
  const stateToken = getLocationStateToken(location.state).trim();
  const [showPassword, setShowPassword] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const form = useForm<ResetPasswordFormValues>({
    defaultValues: {
      newPassword: '',
    },
    mode: 'onTouched',
    reValidateMode: 'onChange',
    resolver: zodResolver(resetPasswordSchema),
  });
  const { field: newPasswordField } = useController({
    control: form.control,
    name: 'newPassword',
  });
  const requireReauth = useAuthStore((state) => state.requireReauth);
  const storeMfaRecoveryProof = useAuthStore((state) => state.storeMfaRecoveryProof);
  const resetToken = (queryToken || stateToken).trim();
  const { displayMode, handleTabNavigation } = useAuthTabsNavigation('login');
  const { isPasswordValid, passwordPolicyMessage } = getResetPasswordState(newPasswordField.value);

  useEffect(() => {
    if (!queryToken) {
      return;
    }

    navigate(buildResetPasswordPath(undefined, redirectPath), {
      replace: true,
      state: {
        resetToken: queryToken,
      },
    });
  }, [navigate, queryToken, redirectPath]);

  const frameProps: AuthFrameControllerProps = useMemo(() => ({
    displayMode,
    onLoginTabClick: handleTabNavigation('/login'),
    onRegisterTabClick: handleTabNavigation('/register'),
  }), [displayMode, handleTabNavigation]);

  const handleSubmit = form.handleSubmit(async ({ newPassword }) => {
    setErrorMessage(null);

    if (!resetToken) {
      setErrorMessage('재설정 링크가 유효하지 않거나 만료되었습니다. 비밀번호 재설정을 다시 요청해 주세요.');
      return;
    }

    try {
      const result = await resetPassword({
        token: resetToken,
        newPassword,
      });

      if (result.recoveryProof) {
        storeMfaRecoveryProof(
          result.recoveryProof,
          result.recoveryProofExpiresInSeconds,
        );
        navigate(buildMfaRecoveryPath(undefined, redirectPath), {
          replace: true,
        });
      } else {
        navigate(buildPasswordResetSuccessLoginPath(redirectPath), {
          replace: true,
        });
      }
    } catch (error) {
      const presentation = resolveAuthErrorPresentation(error);

      if (presentation.semantic === 'reauth-required') {
        requireReauth(presentation.message);
        navigate(redirectPath ? buildLoginRedirect(redirectPath) : '/login', {
          replace: true,
        });
        return;
      }

      setErrorMessage(presentation.message);
      if (presentation.recoveryAction === 'fix-password') {
        form.setError('newPassword', {
          type: 'server',
          message: presentation.message,
        });
      }
    }
  }, (errors) => {
    setErrorMessage(errors.newPassword?.message ?? null);
  });

  return {
    frameProps,
    formProps: {
      hasToken: Boolean(resetToken),
      newPassword: newPasswordField.value,
      showPassword,
      passwordInvalid: Boolean(form.formState.errors.newPassword),
      passwordPolicyMessage,
      errorMessage,
      isSubmitting: form.formState.isSubmitting,
      onPasswordChange: (value: string) => {
        newPasswordField.onChange(value);
        setErrorMessage(null);
      },
      onPasswordBlur: newPasswordField.onBlur,
      onTogglePasswordVisibility: () => {
        setShowPassword((current) => !current);
      },
      onSubmit: () => {
        void handleSubmit();
      },
    },
    isPasswordValid,
  };
};
