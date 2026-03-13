import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import {
  bootstrapAuthenticatedTotpRebind,
  bootstrapRecoveryTotpRebind,
} from '@/api/authApi';
import { useAuthTabsNavigation } from '@/hooks/auth/useAuthTabsNavigation';
import type { AuthFrameControllerProps } from '@/hooks/auth/controllerTypes';
import { resolveMfaErrorPresentation } from '@/lib/auth-errors';
import {
  buildForgotPasswordPath,
  buildMfaRecoveryRebindPath,
  resolveRedirectTarget,
} from '@/router/navigation';
import { useAuthStore } from '@/store/useAuthStore';

export const useMfaRecoveryPageController = () => {
  const status = useAuthStore((state) => state.status);
  const member = useAuthStore((state) => state.member);
  const mfaRecovery = useAuthStore((state) => state.mfaRecovery);
  const clearPendingMfa = useAuthStore((state) => state.clearPendingMfa);
  const clearMfaRecovery = useAuthStore((state) => state.clearMfaRecovery);
  const openMfaRecovery = useAuthStore((state) => state.openMfaRecovery);
  const storeMfaRecoveryBootstrap = useAuthStore((state) => state.storeMfaRecoveryBootstrap);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [currentPassword, setCurrentPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasAttemptedProofBootstrap, setHasAttemptedProofBootstrap] = useState(false);
  const proofBootstrapRequestIdRef = useRef(0);
  const { displayMode, handleTabNavigation } = useAuthTabsNavigation('login');
  const suggestedEmail = (searchParams.get('email') ?? mfaRecovery?.suggestedEmail ?? '').trim();
  const redirectPath = searchParams.get('redirect')
    ? resolveRedirectTarget(searchParams.get('redirect'))
    : undefined;
  const hasRecoveryProof = Boolean(mfaRecovery?.recoveryProof);
  const isAuthenticatedEntry = status === 'authenticated' && Boolean(member);

  useEffect(() => {
    openMfaRecovery(suggestedEmail);
  }, [openMfaRecovery, suggestedEmail]);

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

  const handleSubmit = async () => {
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
      setErrorMessage(resolveMfaErrorPresentation(error).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const frameProps: AuthFrameControllerProps = useMemo(() => ({
    displayMode,
    onLoginTabClick: handleTabNavigation('/login'),
    onRegisterTabClick: handleTabNavigation('/register'),
  }), [displayMode, handleTabNavigation]);

  return {
    frameProps,
    formProps: {
      currentPassword,
      errorMessage,
      forgotPasswordHref: buildForgotPasswordPath(suggestedEmail, redirectPath),
      hasRecoveryProof,
      isAuthenticatedEntry,
      isSubmitting,
      suggestedEmail,
      onCurrentPasswordChange: (value: string) => {
        setCurrentPassword(value);
        setErrorMessage(null);
      },
      onRetryProofBootstrap: () => {
        setHasAttemptedProofBootstrap(false);
        setErrorMessage(null);
      },
      onSubmit: handleSubmit,
    },
  };
};
