import { type FormEventHandler, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { zodResolver } from '@hookform/resolvers/zod';
import { useController, useForm } from 'react-hook-form';

import { confirmMfaRecoveryRebind } from '@/api/authApi';
import { useAuthTabsNavigation } from '@/hooks/auth/useAuthTabsNavigation';
import type { AuthFrameControllerProps } from '@/hooks/auth/controllerTypes';
import {
  sanitizeOtpCodeInput,
  useExpiryCountdown,
} from '@/hooks/auth/useTotpHelpers';
import { resolveMfaErrorPresentation } from '@/lib/auth-errors';
import {
  mfaRecoveryRebindSchema,
  type MfaRecoveryRebindFormValues,
} from '@/lib/schemas/auth.schema';
import {
  buildMfaRecoveryPath,
  buildMfaRecoverySuccessLoginPath,
  resolveRedirectTarget,
} from '@/router/navigation';
import { useAuthStore } from '@/store/useAuthStore';

export const useMfaRecoveryRebindPageController = () => {
  const mfaRecovery = useAuthStore((state) => state.mfaRecovery);
  const clearPendingMfa = useAuthStore((state) => state.clearPendingMfa);
  const clearMfaRecovery = useAuthStore((state) => state.clearMfaRecovery);
  const logout = useAuthStore((state) => state.logout);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const bootstrap = mfaRecovery?.bootstrap;
  const redirectPath = searchParams.get('redirect')
    ? resolveRedirectTarget(searchParams.get('redirect'))
    : undefined;
  const { displayMode, handleTabNavigation } = useAuthTabsNavigation('login');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isCompleting, setIsCompleting] = useState(false);
  const [isRestartingRecovery, setIsRestartingRecovery] = useState(false);
  const form = useForm<MfaRecoveryRebindFormValues>({
    defaultValues: {
      otpCode: '',
    },
    mode: 'onTouched',
    reValidateMode: 'onChange',
    resolver: zodResolver(mfaRecoveryRebindSchema),
  });
  const { field: otpCodeField } = useController({
    control: form.control,
    name: 'otpCode',
  });
  const countdown = useExpiryCountdown(bootstrap?.expiresAt ?? new Date().toISOString());

  useEffect(() => {
    if (!bootstrap && !isCompleting && !isRestartingRecovery) {
      navigate(buildMfaRecoveryPath(mfaRecovery?.suggestedEmail, redirectPath), {
        replace: true,
      });
    }
  }, [bootstrap, isCompleting, isRestartingRecovery, mfaRecovery?.suggestedEmail, navigate, redirectPath]);

  const handleSubmit: FormEventHandler<HTMLFormElement> = form.handleSubmit(async ({ otpCode }) => {
    if (!bootstrap) {
      clearMfaRecovery();
      navigate(buildMfaRecoveryPath(mfaRecovery?.suggestedEmail, redirectPath), {
        replace: true,
      });
      return;
    }
    setErrorMessage(null);

    try {
      const result = await confirmMfaRecoveryRebind({
        rebindToken: bootstrap.rebindToken,
        enrollmentToken: bootstrap.enrollmentToken,
        otpCode: sanitizeOtpCodeInput(otpCode),
      });

      if (result.rebindCompleted) {
        setIsCompleting(true);
        logout();
        clearPendingMfa();
        clearMfaRecovery();
        navigate(buildMfaRecoverySuccessLoginPath(redirectPath), {
          replace: true,
        });
      }
    } catch (error) {
      const presentation = resolveMfaErrorPresentation(error);

      if (presentation.code === 'AUTH-019' || presentation.code === 'AUTH-020') {
        setIsRestartingRecovery(true);
        clearPendingMfa();
        clearMfaRecovery();
        navigate(buildMfaRecoveryPath(mfaRecovery?.suggestedEmail, redirectPath), {
          replace: true,
          state: {
            recoveryErrorMessage: presentation.message,
          },
        });
        return;
      }

      setErrorMessage(presentation.message);
    }
  }, (errors) => {
    const message = errors.otpCode?.message ?? null;
    setErrorMessage(
      message === '인증 코드를 입력해 주세요.'
        ? '현재 인증 코드는 숫자 6자리로 입력해 주세요.'
        : message,
    );
  });

  const frameProps: AuthFrameControllerProps = useMemo(() => ({
    displayMode,
    feedbackMessage: '복구가 완료되면 기존 로그인 상태는 모두 해제되고 새 authenticator로 다시 로그인해야 합니다.',
    feedbackTone: 'info',
    feedbackTestId: 'mfa-recovery-guidance',
    onLoginTabClick: handleTabNavigation('/login'),
    onRegisterTabClick: handleTabNavigation('/register'),
  }), [displayMode, handleTabNavigation]);

  return {
    frameProps,
    formProps: {
      qrUri: bootstrap?.qrUri ?? '',
      manualEntryKey: bootstrap?.manualEntryKey ?? '',
      otpCode: otpCodeField.value,
      errorMessage,
      expiresAtLabel: countdown.expiresAtLabel,
      remainingLabel: countdown.remainingLabel,
      isSubmitting: form.formState.isSubmitting,
      onOtpCodeChange: (value: string) => {
        setErrorMessage(null);
        otpCodeField.onChange(sanitizeOtpCodeInput(value));
      },
      onOtpCodeBlur: otpCodeField.onBlur,
      onRestartRecovery: () => {
        setIsRestartingRecovery(true);
        clearMfaRecovery();
        navigate(buildMfaRecoveryPath(mfaRecovery?.suggestedEmail, redirectPath), {
          replace: true,
        });
      },
      onSubmit: handleSubmit,
    },
  };
};
