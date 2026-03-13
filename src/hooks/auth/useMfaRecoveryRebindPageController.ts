import { type FormEventHandler, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { confirmMfaRecoveryRebind } from '@/api/authApi';
import { useAuthTabsNavigation } from '@/hooks/auth/useAuthTabsNavigation';
import type { AuthFrameControllerProps } from '@/hooks/auth/controllerTypes';
import {
  isCompleteOtpCode,
  sanitizeOtpCodeInput,
  useExpiryCountdown,
} from '@/hooks/auth/useTotpHelpers';
import { resolveMfaErrorPresentation } from '@/lib/auth-errors';
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
  const [otpCode, setOtpCode] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCompleting, setIsCompleting] = useState(false);
  const countdown = useExpiryCountdown(bootstrap?.expiresAt ?? new Date().toISOString());

  useEffect(() => {
    if (!bootstrap && !isCompleting) {
      navigate(buildMfaRecoveryPath(mfaRecovery?.suggestedEmail, redirectPath), {
        replace: true,
      });
    }
  }, [bootstrap, isCompleting, mfaRecovery?.suggestedEmail, navigate, redirectPath]);

  const handleSubmit: FormEventHandler<HTMLFormElement> = async (event) => {
    event.preventDefault();

    if (!bootstrap) {
      clearMfaRecovery();
      navigate(buildMfaRecoveryPath(mfaRecovery?.suggestedEmail, redirectPath), {
        replace: true,
      });
      return;
    }

    const normalizedOtp = sanitizeOtpCodeInput(otpCode);

    if (!isCompleteOtpCode(normalizedOtp)) {
      setErrorMessage('현재 인증 코드는 숫자 6자리로 입력해 주세요.');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const result = await confirmMfaRecoveryRebind({
        rebindToken: bootstrap.rebindToken,
        enrollmentToken: bootstrap.enrollmentToken,
        otpCode: normalizedOtp,
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
      setErrorMessage(resolveMfaErrorPresentation(error).message);
    } finally {
      setIsSubmitting(false);
    }
  };

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
      otpCode,
      errorMessage,
      expiresAtLabel: countdown.expiresAtLabel,
      remainingLabel: countdown.remainingLabel,
      isSubmitting,
      onOtpCodeChange: (value: string) => {
        setErrorMessage(null);
        setOtpCode(sanitizeOtpCodeInput(value));
      },
      onRestartRecovery: () => {
        clearMfaRecovery();
        navigate(buildMfaRecoveryPath(mfaRecovery?.suggestedEmail, redirectPath), {
          replace: true,
        });
      },
      onSubmit: handleSubmit,
    },
  };
};
