import { useState, type FormEventHandler } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { startLoginFlow, verifyLoginOtp } from '@/api/authApi';
import {
  isCompleteOtpCode,
  sanitizeOtpCodeInput,
  useExpiryCountdown,
} from '@/hooks/auth/useTotpHelpers';
import { useAuthTabsNavigation } from '@/hooks/auth/useAuthTabsNavigation';
import { useLoginFormState } from '@/hooks/auth/useLoginFormState';
import type { AuthFrameControllerProps } from '@/hooks/auth/controllerTypes';
import {
  getAuthErrorMessage,
  resolveMfaErrorPresentation,
} from '@/lib/auth-errors';
import {
  buildLoginRedirect,
  buildMfaRecoveryPath,
  buildTotpEnrollmentRedirect,
  buildRouteWithRedirect,
  buildForgotPasswordPath,
  hasMfaRecoverySuccessQuery,
  hasPasswordResetSuccessQuery,
  resolveMfaRecoveryRoute,
  resolveTotpEnrollmentRoute,
  resolveRedirectTarget,
} from '@/router/navigation';
import { useAuthStore } from '@/store/useAuthStore';

export const useLoginPageController = () => {
  const login = useAuthStore((state) => state.login);
  const pendingMfa = useAuthStore((state) => state.pendingMfa);
  const reauthMessage = useAuthStore((state) => state.reauthMessage);
  const clearReauthMessage = useAuthStore((state) => state.clearReauthMessage);
  const startMfaChallenge = useAuthStore((state) => state.startMfaChallenge);
  const updatePendingMfa = useAuthStore((state) => state.updatePendingMfa);
  const clearPendingMfa = useAuthStore((state) => state.clearPendingMfa);
  const openMfaRecovery = useAuthStore((state) => state.openMfaRecovery);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirectPath = resolveRedirectTarget(searchParams.get('redirect'));
  const hasPasswordResetSuccess = hasPasswordResetSuccessQuery(searchParams);
  const hasMfaRecoverySuccess = hasMfaRecoverySuccessQuery(searchParams);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPasswordRecoveryHelp, setShowPasswordRecoveryHelp] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const loginForm = useLoginFormState();
  const { displayMode, handleTabNavigation } = useAuthTabsNavigation('login');
  const isMfaStep = pendingMfa?.nextAction === 'VERIFY_TOTP';
  const pendingMfaEmail = pendingMfa?.email?.trim() ?? '';
  const countdown = useExpiryCountdown(
    pendingMfa?.expiresAt ?? new Date().toISOString(),
  );

  const restartPasswordStep = () => {
    clearPendingMfa();
    setOtpCode('');
    setErrorMessage(null);
  };

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
      const redirectPath = resolveRedirectTarget(searchParams.get('redirect'));
      const challenge = await startLoginFlow(loginForm.getPayload());
      startMfaChallenge(
        challenge,
        redirectPath,
        loginForm.email.trim(),
      );
      setOtpCode('');

      if (challenge.nextAction === 'ENROLL_TOTP') {
        navigate(buildTotpEnrollmentRedirect(redirectPath), {
          replace: true,
        });
      } else {
        navigate(buildLoginRedirect(redirectPath), {
          replace: true,
        });
      }
    } catch (error) {
      setErrorMessage(getAuthErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleVerifyMfa: FormEventHandler<HTMLFormElement> = async (event) => {
    event.preventDefault();

    if (!pendingMfa) {
      restartPasswordStep();
      return;
    }

    const normalizedOtp = sanitizeOtpCodeInput(otpCode);

    if (!isCompleteOtpCode(normalizedOtp)) {
      setErrorMessage('인증 코드는 숫자 6자리로 입력해 주세요.');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const member = await verifyLoginOtp({
        loginToken: pendingMfa.loginToken,
        otpCode: normalizedOtp,
      });
      login(member);
      navigate(pendingMfa.redirectPath, {
        replace: true,
      });
    } catch (error) {
      const presentation = resolveMfaErrorPresentation(error);

      if (presentation.navigateToEnroll) {
        updatePendingMfa({
          nextAction: 'ENROLL_TOTP',
        });
        navigate(
          buildRouteWithRedirect(
            resolveTotpEnrollmentRoute(presentation.enrollUrl),
            pendingMfa.redirectPath,
          ),
          {
            replace: true,
          },
        );
      } else if (presentation.restartLogin) {
        useAuthStore.getState().requireReauth(presentation.message);
        restartPasswordStep();
      } else if (presentation.navigateToRecovery) {
        const recoveryEmail = pendingMfaEmail || loginForm.email.trim();
        const recoveryRoute = resolveMfaRecoveryRoute(presentation.recoveryUrl)
          === buildMfaRecoveryPath()
          ? buildMfaRecoveryPath(recoveryEmail)
          : resolveMfaRecoveryRoute(presentation.recoveryUrl);

        clearPendingMfa();
        openMfaRecovery(recoveryEmail);
        navigate(
          buildRouteWithRedirect(recoveryRoute, pendingMfa.redirectPath),
          {
            replace: true,
          },
        );
      } else {
        setErrorMessage(presentation.message);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const frameProps: AuthFrameControllerProps = {
    displayMode,
    feedbackMessage: isMfaStep
      ? null
      : reauthMessage ?? (
        hasPasswordResetSuccess
          ? '비밀번호가 변경되었습니다. 새 비밀번호로 로그인해 주세요.'
          : hasMfaRecoverySuccess
            ? '새 authenticator 등록이 완료되었습니다. 새 비밀번호와 현재 인증 코드로 다시 로그인해 주세요.'
          : null
      ),
    feedbackTone: 'info',
    feedbackTestId: reauthMessage
      ? 'reauth-guidance'
      : hasPasswordResetSuccess
        ? 'password-reset-success'
        : hasMfaRecoverySuccess
          ? 'mfa-recovery-success'
        : undefined,
    onLoginTabClick: handleTabNavigation('/login'),
    onRegisterTabClick: handleTabNavigation('/register'),
  };

  return {
    isMfaStep,
    titleLines: isMfaStep
      ? ['보안 인증을 완료해 주세요']
      : ['FIX 플랫폼에 오신 것을', '환영합니다!'],
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
      forgotPasswordHref: buildForgotPasswordPath(loginForm.email, redirectPath),
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
    mfaFormProps: {
      otpCode,
      errorMessage,
      expiresAtLabel: countdown.expiresAtLabel,
      remainingLabel: countdown.remainingLabel,
      isSubmitting,
      onOtpCodeChange: (value: string) => {
        setErrorMessage(null);
        setOtpCode(sanitizeOtpCodeInput(value));
      },
      onRestartLogin: restartPasswordStep,
      onSubmit: handleVerifyMfa,
    },
  };
};
