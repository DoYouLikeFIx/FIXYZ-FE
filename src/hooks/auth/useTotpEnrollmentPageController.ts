import { useEffect, useState, type FormEventHandler } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import {
  beginTotpEnrollment,
  confirmTotpEnrollment,
} from '@/api/authApi';
import { useAuth } from '@/hooks/auth/useAuth';
import {
  isCompleteOtpCode,
  sanitizeOtpCodeInput,
  useExpiryCountdown,
} from '@/hooks/auth/useTotpHelpers';
import type { AuthFrameControllerProps } from '@/hooks/auth/controllerTypes';
import { resolveMfaErrorPresentation } from '@/lib/auth-errors';
import {
  buildLoginRedirect,
  resolveRedirectTarget,
  TOTP_ENROLL_ROUTE,
} from '@/router/navigation';
import type { TotpEnrollmentBootstrap } from '@/types/auth';

export const useTotpEnrollmentPageController = () => {
  const login = useAuth((state) => state.login);
  const pendingMfa = useAuth((state) => state.pendingMfa);
  const requireReauth = useAuth((state) => state.requireReauth);
  const clearPendingMfa = useAuth((state) => state.clearPendingMfa);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [bootstrap, setBootstrap] = useState<TotpEnrollmentBootstrap | null>(null);
  const [otpCode, setOtpCode] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoadingBootstrap, setIsLoadingBootstrap] = useState(
    pendingMfa?.nextAction === 'ENROLL_TOTP',
  );
  const [isSubmitting, setIsSubmitting] = useState(false);

  const redirectPath = pendingMfa?.redirectPath ?? resolveRedirectTarget(searchParams.get('redirect'));

  useEffect(() => {
    if (!pendingMfa || pendingMfa.nextAction !== 'ENROLL_TOTP' || bootstrap) {
      return;
    }

    let active = true;
    setIsLoadingBootstrap(true);
    setErrorMessage(null);
    // Defer the bootstrap until the next task so React StrictMode's
    // mount/unmount replay does not leave duplicate enroll requests aborted.
    const bootstrapTimer = window.setTimeout(() => {
      void beginTotpEnrollment({
        loginToken: pendingMfa.loginToken,
      })
        .then((nextBootstrap) => {
          if (!active) {
            return;
          }

          setBootstrap(nextBootstrap);
        })
        .catch((error) => {
          if (!active) {
            return;
          }

          const presentation = resolveMfaErrorPresentation(error);

          if (presentation.restartLogin) {
            requireReauth(presentation.message);
            clearPendingMfa();
            navigate(buildLoginRedirect(redirectPath), { replace: true });
            return;
          }

          setErrorMessage(presentation.message);
        })
        .finally(() => {
          if (active) {
            setIsLoadingBootstrap(false);
          }
        });
    }, 0);

    return () => {
      active = false;
      window.clearTimeout(bootstrapTimer);
    };
  }, [bootstrap, clearPendingMfa, navigate, pendingMfa, redirectPath, requireReauth]);

  const countdown = useExpiryCountdown(
    bootstrap?.expiresAt ?? pendingMfa?.expiresAt ?? new Date().toISOString(),
  );

  const handleRestartLogin = () => {
    clearPendingMfa();
    setBootstrap(null);
    setOtpCode('');
    setErrorMessage(null);
    navigate(buildLoginRedirect(redirectPath), { replace: true });
  };

  const handleSubmit: FormEventHandler<HTMLFormElement> = async (event) => {
    event.preventDefault();

    if (!pendingMfa || !bootstrap) {
      handleRestartLogin();
      return;
    }

    const normalizedOtp = sanitizeOtpCodeInput(otpCode);

    if (!isCompleteOtpCode(normalizedOtp)) {
      setErrorMessage('첫 인증 코드는 숫자 6자리로 입력해 주세요.');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const member = await confirmTotpEnrollment({
        loginToken: pendingMfa.loginToken,
        enrollmentToken: bootstrap.enrollmentToken,
        otpCode: normalizedOtp,
      });

      login(member);
      navigate(pendingMfa.redirectPath, {
        replace: true,
      });
    } catch (error) {
      const presentation = resolveMfaErrorPresentation(error);

      if (presentation.restartLogin) {
        requireReauth(presentation.message);
        clearPendingMfa();
        navigate(buildLoginRedirect(redirectPath), { replace: true });
      } else {
        setErrorMessage(presentation.message);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const frameProps: AuthFrameControllerProps = {
    displayMode: 'login',
    feedbackMessage: 'Google Authenticator 등록이 완료되어야 보호된 화면으로 이동할 수 있습니다.',
    feedbackTone: 'info',
    feedbackTestId: 'totp-enrollment-guidance',
    onLoginTabClick: (event) => {
      event.preventDefault();
      handleRestartLogin();
    },
    onRegisterTabClick: (event) => {
      event.preventDefault();
      handleRestartLogin();
    },
  };

  return {
    frameProps,
    title: 'Google Authenticator를 연결해 주세요',
    subtitle: '처음 로그인하는 계정은 2차 인증 등록을 먼저 완료해야 합니다.',
    formProps: {
      qrUri: bootstrap?.qrUri ?? '',
      manualEntryKey: bootstrap?.manualEntryKey ?? '',
      otpCode,
      errorMessage,
      expiresAtLabel: countdown.expiresAtLabel,
      remainingLabel: countdown.remainingLabel,
      isLoadingBootstrap,
      isSubmitting,
      onOtpCodeChange: (value: string) => {
        setErrorMessage(null);
        setOtpCode(sanitizeOtpCodeInput(value));
      },
      onRestartLogin: handleRestartLogin,
      onSubmit: handleSubmit,
    },
    routePath: TOTP_ENROLL_ROUTE,
  };
};
