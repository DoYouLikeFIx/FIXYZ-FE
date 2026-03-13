import { useState, type FormEventHandler } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { zodResolver } from '@hookform/resolvers/zod';
import { useController, useForm } from 'react-hook-form';

import { startLoginFlow, verifyLoginOtp } from '@/api/authApi';
import {
  sanitizeOtpCodeInput,
  useExpiryCountdown,
} from '@/hooks/auth/useTotpHelpers';
import { useAuthTabsNavigation } from '@/hooks/auth/useAuthTabsNavigation';
import type { AuthFrameControllerProps } from '@/hooks/auth/controllerTypes';
import {
  getAuthErrorMessage,
  resolveMfaErrorPresentation,
} from '@/lib/auth-errors';
import {
  loginMfaSchema,
  loginSchema,
  type LoginFormValues,
  type LoginMfaFormValues,
} from '@/lib/schemas/auth.schema';
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
  const [showPasswordRecoveryHelp, setShowPasswordRecoveryHelp] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const loginForm = useForm<LoginFormValues>({
    defaultValues: {
      email: '',
      password: '',
    },
    mode: 'onTouched',
    reValidateMode: 'onChange',
    resolver: zodResolver(loginSchema),
  });
  const loginMfaForm = useForm<LoginMfaFormValues>({
    defaultValues: {
      otpCode: '',
    },
    mode: 'onTouched',
    reValidateMode: 'onChange',
    resolver: zodResolver(loginMfaSchema),
  });
  const { field: emailField } = useController({
    control: loginForm.control,
    name: 'email',
  });
  const { field: passwordField } = useController({
    control: loginForm.control,
    name: 'password',
  });
  const { field: otpCodeField } = useController({
    control: loginMfaForm.control,
    name: 'otpCode',
  });
  const { displayMode, handleTabNavigation } = useAuthTabsNavigation('login');
  const isMfaStep = pendingMfa?.nextAction === 'VERIFY_TOTP';
  const pendingMfaEmail = pendingMfa?.email?.trim() ?? '';
  const countdown = useExpiryCountdown(
    pendingMfa?.expiresAt ?? new Date().toISOString(),
  );

  const restartPasswordStep = () => {
    clearPendingMfa();
    loginMfaForm.reset();
    setErrorMessage(null);
  };

  const handleSubmit: FormEventHandler<HTMLFormElement> = loginForm.handleSubmit(async (values) => {
    setErrorMessage(null);
    clearReauthMessage();

    try {
      const redirectPath = resolveRedirectTarget(searchParams.get('redirect'));
      const challenge = await startLoginFlow({
        email: values.email.trim(),
        password: values.password,
      });
      startMfaChallenge(
        challenge,
        redirectPath,
        values.email.trim(),
      );
      loginMfaForm.reset();

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
    }
  }, (errors) => {
    setErrorMessage(
      errors.email?.message
      ?? errors.password?.message
      ?? null,
    );
  });

  const handleVerifyMfa: FormEventHandler<HTMLFormElement> = loginMfaForm.handleSubmit(async ({ otpCode }) => {
    if (!pendingMfa) {
      restartPasswordStep();
      return;
    }

    setErrorMessage(null);

    try {
      const member = await verifyLoginOtp({
        loginToken: pendingMfa.loginToken,
        otpCode: sanitizeOtpCodeInput(otpCode),
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
        const recoveryEmail = pendingMfaEmail || emailField.value.trim();
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
    }
  }, (errors) => {
    const message = errors.otpCode?.message ?? null;
    setErrorMessage(
      message === '인증 코드를 입력해 주세요.'
        ? '인증 코드는 숫자 6자리로 입력해 주세요.'
        : message,
    );
  });

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
      email: emailField.value,
      password: passwordField.value,
      showPassword,
      emailInvalid: Boolean(loginForm.formState.errors.email),
      passwordInvalid: Boolean(loginForm.formState.errors.password),
      showPasswordRecoveryHelp,
      errorMessage,
      isSubmitting: loginForm.formState.isSubmitting,
      forgotPasswordHref: buildForgotPasswordPath(emailField.value, redirectPath),
      onEmailChange: (value: string) => {
        setErrorMessage(null);
        emailField.onChange(value);
      },
      onEmailBlur: emailField.onBlur,
      onPasswordChange: (value: string) => {
        setErrorMessage(null);
        passwordField.onChange(value);
      },
      onPasswordBlur: passwordField.onBlur,
      onTogglePasswordVisibility: () => {
        setShowPassword((current) => !current);
      },
      onTogglePasswordRecoveryHelp: () => {
        setShowPasswordRecoveryHelp((current) => !current);
      },
      onSubmit: handleSubmit,
    },
    mfaFormProps: {
      otpCode: otpCodeField.value,
      errorMessage,
      expiresAtLabel: countdown.expiresAtLabel,
      remainingLabel: countdown.remainingLabel,
      isSubmitting: loginMfaForm.formState.isSubmitting,
      onOtpCodeChange: (value: string) => {
        setErrorMessage(null);
        otpCodeField.onChange(sanitizeOtpCodeInput(value));
      },
      onOtpCodeBlur: otpCodeField.onBlur,
      onRestartLogin: restartPasswordStep,
      onSubmit: handleVerifyMfa,
    },
  };
};
