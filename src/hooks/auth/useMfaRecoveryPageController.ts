import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { zodResolver } from '@hookform/resolvers/zod';
import { useController, useForm } from 'react-hook-form';

import {
  bootstrapAuthenticatedTotpRebind,
  bootstrapRecoveryTotpRebind,
} from '@/api/authApi';
import { useAuthTabsNavigation } from '@/hooks/auth/useAuthTabsNavigation';
import type { AuthFrameControllerProps } from '@/hooks/auth/controllerTypes';
import { resolveMfaErrorPresentation } from '@/lib/auth-errors';
import {
  mfaRecoveryEntrySchema,
  type MfaRecoveryEntryFormValues,
} from '@/lib/schemas/auth.schema';
import {
  buildLoginRedirect,
  buildForgotPasswordPath,
  buildMfaRecoveryRebindPath,
  DEFAULT_PROTECTED_ROUTE,
  resolveRedirectTarget,
} from '@/router/navigation';
import { useAuthStore } from '@/store/useAuthStore';

interface MfaRecoveryLocationState {
  recoveryErrorMessage?: string;
}

const getLocationRecoveryError = (state: unknown) => {
  if (!state || typeof state !== 'object') {
    return null;
  }

  const candidate = state as MfaRecoveryLocationState;
  return typeof candidate.recoveryErrorMessage === 'string'
    ? candidate.recoveryErrorMessage
    : null;
};

export const useMfaRecoveryPageController = () => {
  const status = useAuthStore((state) => state.status);
  const member = useAuthStore((state) => state.member);
  const mfaRecovery = useAuthStore((state) => state.mfaRecovery);
  const clearPendingMfa = useAuthStore((state) => state.clearPendingMfa);
  const clearMfaRecovery = useAuthStore((state) => state.clearMfaRecovery);
  const openMfaRecovery = useAuthStore((state) => state.openMfaRecovery);
  const requireReauth = useAuthStore((state) => state.requireReauth);
  const storeMfaRecoveryBootstrap = useAuthStore((state) => state.storeMfaRecoveryBootstrap);
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasAttemptedProofBootstrap, setHasAttemptedProofBootstrap] = useState(false);
  const proofBootstrapRequestIdRef = useRef(0);
  const form = useForm<MfaRecoveryEntryFormValues>({
    defaultValues: {
      currentPassword: '',
    },
    mode: 'onTouched',
    reValidateMode: 'onChange',
    resolver: zodResolver(mfaRecoveryEntrySchema),
  });
  const { field: currentPasswordField } = useController({
    control: form.control,
    name: 'currentPassword',
  });
  const { displayMode, handleTabNavigation } = useAuthTabsNavigation('login');
  const suggestedEmail = (searchParams.get('email') ?? mfaRecovery?.suggestedEmail ?? '').trim();
  const redirectPath = searchParams.get('redirect')
    ? resolveRedirectTarget(searchParams.get('redirect'))
    : undefined;
  const hasRecoveryProof = Boolean(mfaRecovery?.recoveryProof);
  const isAuthenticatedEntry = status === 'authenticated' && Boolean(member);
  const recoveryErrorMessage = getLocationRecoveryError(location.state);

  useEffect(() => {
    openMfaRecovery(suggestedEmail);
  }, [openMfaRecovery, suggestedEmail]);

  useEffect(() => {
    if (recoveryErrorMessage) {
      setErrorMessage(recoveryErrorMessage);
    }
  }, [recoveryErrorMessage]);

  useEffect(() => {
    setHasAttemptedProofBootstrap(false);
    if (mfaRecovery?.recoveryProof) {
      setErrorMessage(null);
    }
  }, [mfaRecovery?.recoveryProof]);

  useEffect(() => {
    if (mfaRecovery?.bootstrap) {
      navigate(buildMfaRecoveryRebindPath(redirectPath), {
        replace: true,
      });
    }
  }, [mfaRecovery?.bootstrap, navigate, redirectPath]);

  useEffect(() => () => {
    proofBootstrapRequestIdRef.current += 1;
  }, []);

  useEffect(() => {
    if (
      !hasRecoveryProof
      || isAuthenticatedEntry
      || mfaRecovery?.bootstrap
      || isSubmitting
      || hasAttemptedProofBootstrap
    ) {
      return;
    }

    const requestId = proofBootstrapRequestIdRef.current + 1;
    proofBootstrapRequestIdRef.current = requestId;
    setHasAttemptedProofBootstrap(true);
    setIsSubmitting(true);
    setErrorMessage(null);

    void bootstrapRecoveryTotpRebind({
      recoveryProof: mfaRecovery?.recoveryProof ?? '',
    })
      .then((bootstrap) => {
        if (proofBootstrapRequestIdRef.current !== requestId) {
          return;
        }

        clearPendingMfa();
        storeMfaRecoveryBootstrap(bootstrap);
        navigate(buildMfaRecoveryRebindPath(redirectPath), {
          replace: true,
        });
      })
      .catch((error) => {
        if (proofBootstrapRequestIdRef.current !== requestId) {
          return;
        }

        const presentation = resolveMfaErrorPresentation(error);

        if (presentation.code === 'AUTH-019' || presentation.code === 'AUTH-020') {
          clearPendingMfa();
          clearMfaRecovery();
          openMfaRecovery(suggestedEmail);
        }

        setErrorMessage(presentation.message);
      })
      .finally(() => {
        if (proofBootstrapRequestIdRef.current === requestId) {
          setIsSubmitting(false);
        }
      });
  }, [
    clearPendingMfa,
    clearMfaRecovery,
    hasAttemptedProofBootstrap,
    hasRecoveryProof,
    isAuthenticatedEntry,
    isSubmitting,
    mfaRecovery?.bootstrap,
    mfaRecovery?.recoveryProof,
    navigate,
    openMfaRecovery,
    storeMfaRecoveryBootstrap,
    redirectPath,
    suggestedEmail,
  ]);

  const handleSubmit = form.handleSubmit(async ({ currentPassword }) => {
    if (!isAuthenticatedEntry) {
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const bootstrap = await bootstrapAuthenticatedTotpRebind({
        currentPassword,
      });

      clearPendingMfa();
      storeMfaRecoveryBootstrap(bootstrap);
      navigate(buildMfaRecoveryRebindPath(redirectPath), {
        replace: true,
      });
    } catch (error) {
      const presentation = resolveMfaErrorPresentation(error);

      if (presentation.navigateToEnroll) {
        clearPendingMfa();
        clearMfaRecovery();
        requireReauth('Google Authenticator 등록이 필요합니다. 다시 로그인하면 인증 앱 등록 단계로 이동합니다.');
        navigate(
          buildLoginRedirect(redirectPath ?? DEFAULT_PROTECTED_ROUTE),
          { replace: true },
        );
        return;
      }

      setErrorMessage(presentation.message);
    } finally {
      setIsSubmitting(false);
    }
  }, (errors) => {
    setErrorMessage(errors.currentPassword?.message ?? null);
  });

  const frameProps: AuthFrameControllerProps = useMemo(() => ({
    displayMode,
    onLoginTabClick: handleTabNavigation('/login'),
    onRegisterTabClick: handleTabNavigation('/register'),
  }), [displayMode, handleTabNavigation]);

  return {
    frameProps,
    formProps: {
      currentPassword: currentPasswordField.value,
      errorMessage,
      forgotPasswordHref: buildForgotPasswordPath(suggestedEmail, redirectPath),
      hasRecoveryProof,
      isAuthenticatedEntry,
      isSubmitting: isSubmitting || form.formState.isSubmitting,
      suggestedEmail,
      onCurrentPasswordChange: (value: string) => {
        currentPasswordField.onChange(value);
        setErrorMessage(null);
      },
      onCurrentPasswordBlur: currentPasswordField.onBlur,
      onRetryProofBootstrap: () => {
        setHasAttemptedProofBootstrap(false);
        setErrorMessage(null);
      },
      onSubmit: () => {
        void handleSubmit();
      },
    },
  };
};
