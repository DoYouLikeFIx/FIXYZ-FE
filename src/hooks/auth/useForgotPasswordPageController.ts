import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { zodResolver } from '@hookform/resolvers/zod';
import { useController, useForm } from 'react-hook-form';

import {
  requestPasswordRecoveryChallenge,
  requestPasswordResetEmail,
} from '@/api/authApi';
import { useAuthTabsNavigation } from '@/hooks/auth/useAuthTabsNavigation';
import type { AuthFrameControllerProps } from '@/hooks/auth/controllerTypes';
import { resolveAuthErrorPresentation } from '@/lib/auth-errors';
import {
  parseRecoveryChallengeBootstrap,
  recoveryChallengeFailClosedMessage,
  reportRecoveryChallengeFailClosed,
  selectRecoveryChallengeSession,
  solveProofOfWorkChallenge,
  type RecoveryChallengeSession,
} from '@/lib/recovery-challenge';
import {
  forgotPasswordSchema,
  type ForgotPasswordFormValues,
} from '@/lib/schemas/auth.schema';
import {
  buildResetPasswordPath,
  resolveRedirectTarget,
} from '@/router/navigation';

interface SolveAttemptState {
  challengeId: string;
  solveToken: number;
}

const CLOCK_SKEW_THRESHOLD_MS = 30_000;
const EXPIRY_SAFETY_MARGIN_MS = 5_000;

export const useForgotPasswordPageController = () => {
  const [searchParams] = useSearchParams();
  const redirectPath = searchParams.get('redirect')
    ? resolveRedirectTarget(searchParams.get('redirect'))
    : undefined;
  const [acceptedMessage, setAcceptedMessage] = useState<string | null>(null);
  const [challengeMayBeRequired, setChallengeMayBeRequired] = useState(false);
  const [challengeState, setChallengeState] = useState<RecoveryChallengeSession | null>(null);
  const challengeStateRef = useRef<RecoveryChallengeSession | null>(null);
  const solveAttemptRef = useRef<SolveAttemptState | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isBootstrappingChallenge, setIsBootstrappingChallenge] = useState(false);
  const form = useForm<ForgotPasswordFormValues>({
    defaultValues: {
      email: searchParams.get('email') ?? '',
      challengeAnswer: '',
      requiresChallenge: false,
    },
    mode: 'onTouched',
    reValidateMode: 'onChange',
    resolver: zodResolver(forgotPasswordSchema),
  });
  const { field: emailField } = useController({
    control: form.control,
    name: 'email',
  });
  const { field: challengeAnswerField } = useController({
    control: form.control,
    name: 'challengeAnswer',
  });
  const { displayMode, handleTabNavigation } = useAuthTabsNavigation('login');

  useEffect(() => {
    challengeStateRef.current = challengeState;
  }, [challengeState]);

  const frameProps: AuthFrameControllerProps = useMemo(() => ({
    displayMode,
    onLoginTabClick: handleTabNavigation('/login'),
    onRegisterTabClick: handleTabNavigation('/register'),
  }), [displayMode, handleTabNavigation]);

  const resetChallengeField = () => {
    form.resetField('challengeAnswer', {
      defaultValue: '',
    });
    form.setValue('requiresChallenge', false, { shouldDirty: false, shouldTouch: false });
    form.clearErrors('challengeAnswer');
  };

  const cancelSolveAttempt = () => {
    solveAttemptRef.current = null;
  };

  const clearActiveChallenge = () => {
    cancelSolveAttempt();
    setChallengeState(null);
    resetChallengeField();
  };

  const failClosedChallenge = (reason: Parameters<typeof recoveryChallengeFailClosedMessage>[0]) => {
    reportRecoveryChallengeFailClosed(reason);
    clearActiveChallenge();
    setErrorMessage(recoveryChallengeFailClosedMessage(reason));
  };

  const solveActiveProofOfWork = async (session: RecoveryChallengeSession) => {
    if (session.kind !== 'proof-of-work') {
      return;
    }

    const solveToken = (solveAttemptRef.current?.solveToken ?? 0) + 1;
    solveAttemptRef.current = {
      challengeId: session.challengeId,
      solveToken,
    };

    setChallengeState((current) => {
      if (current && current.kind === 'proof-of-work' && current.challengeId !== session.challengeId) {
        return current;
      }

      return {
        ...session,
        solveStatus: 'solving',
        challengeAnswer:
          current && current.kind === 'proof-of-work' && current.challengeId === session.challengeId
            ? current.challengeAnswer
            : undefined,
      };
    });

    try {
      const challengeAnswer = await solveProofOfWorkChallenge(
        session.challengePayload.proofOfWork,
        {
          onProgress: () => {
            if (
              solveAttemptRef.current?.challengeId !== session.challengeId ||
              solveAttemptRef.current?.solveToken !== solveToken
            ) {
              return;
            }
          },
        },
      );

      if (
        solveAttemptRef.current?.challengeId !== session.challengeId ||
        solveAttemptRef.current?.solveToken !== solveToken
      ) {
        return;
      }

      setChallengeState((current) => {
        if (current && current.kind === 'proof-of-work' && current.challengeId !== session.challengeId) {
          return current;
        }

        return {
          ...session,
          solveStatus: 'solved',
          challengeAnswer,
        };
      });
      form.setValue('challengeAnswer', challengeAnswer, {
        shouldDirty: true,
        shouldTouch: true,
        shouldValidate: true,
      });
    } catch {
      if (
        solveAttemptRef.current?.challengeId !== session.challengeId ||
        solveAttemptRef.current?.solveToken !== solveToken
      ) {
        return;
      }

      failClosedChallenge('validity-untrusted');
    }
  };

  const normalizeChallengeSession = (
    parsed: ReturnType<typeof parseRecoveryChallengeBootstrap>,
    email: string,
    receivedAtEpochMs: number,
  ): RecoveryChallengeSession | null => {
    if (parsed.kind === 'legacy') {
      return {
        ...parsed.challenge,
        kind: 'legacy',
        email,
        receivedAtEpochMs,
      };
    }

    if (parsed.kind === 'proof-of-work') {
      return {
        ...parsed.challenge,
        kind: 'proof-of-work',
        email,
        receivedAtEpochMs,
        solveStatus: 'idle',
      };
    }

    failClosedChallenge(parsed.reason);
    return null;
  };

  useEffect(() => {
    const currentChallenge = challengeStateRef.current;

    if (!currentChallenge || currentChallenge.kind !== 'proof-of-work') {
      return undefined;
    }

    const validateChallengeTrust = () => {
      const now = Date.now();
      const skewMs = Math.abs(now - currentChallenge.challengeIssuedAtEpochMs);
      const remainingMs = currentChallenge.challengeExpiresAtEpochMs - now;

      if (skewMs > CLOCK_SKEW_THRESHOLD_MS) {
        failClosedChallenge('clock-skew');
        return;
      }

      if (remainingMs <= EXPIRY_SAFETY_MARGIN_MS) {
        failClosedChallenge('validity-untrusted');
      }
    };

    validateChallengeTrust();

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        validateChallengeTrust();
      }
    };

    window.addEventListener('focus', validateChallengeTrust);
    window.addEventListener('pageshow', validateChallengeTrust);
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      window.removeEventListener('focus', validateChallengeTrust);
      window.removeEventListener('pageshow', validateChallengeTrust);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [challengeState]);

  const handleSubmit = form.handleSubmit(async (values) => {
    setErrorMessage(null);

    try {
      const response = await requestPasswordResetEmail({
        email: challengeStateRef.current?.email ?? values.email,
        challengeAnswer: challengeStateRef.current ? values.challengeAnswer.trim() : undefined,
        challengeToken: challengeStateRef.current?.challengeToken,
      });

      setAcceptedMessage(response.message);
      setChallengeMayBeRequired(response.recovery.challengeMayBeRequired);
    } catch (error) {
      const presentation = resolveAuthErrorPresentation(error);
      setAcceptedMessage(null);

      if (challengeStateRef.current) {
        clearActiveChallenge();
      }

      setErrorMessage(presentation.message);
    }
  }, (errors) => {
    setErrorMessage(
      errors.email?.message
      ?? errors.challengeAnswer?.message
      ?? null,
    );
  });

  const handleBootstrapChallenge = async () => {
    setErrorMessage(null);
    const isValid = await form.trigger('email');

    if (!isValid) {
      setErrorMessage(form.formState.errors.email?.message ?? null);
      return;
    }

    setIsBootstrappingChallenge(true);

    try {
      const rawEmail = emailField.value;
      const response = await requestPasswordRecoveryChallenge({
        email: rawEmail,
      });
      const receivedAtEpochMs = Date.now();
      const parsed = parseRecoveryChallengeBootstrap(response, receivedAtEpochMs);

      if (parsed.kind === 'fail-closed') {
        failClosedChallenge(parsed.reason);
        return;
      }

      const nextChallenge = normalizeChallengeSession(parsed, rawEmail, receivedAtEpochMs);
      if (!nextChallenge) {
        return;
      }

      const selection = selectRecoveryChallengeSession(challengeStateRef.current, nextChallenge);
      if (selection.kind === 'stale') {
        return;
      }

      if (selection.kind === 'fail-closed') {
        failClosedChallenge(selection.reason);
        return;
      }

      cancelSolveAttempt();
      setChallengeState(selection.challenge);
      resetChallengeField();
      form.setValue('requiresChallenge', true, { shouldDirty: false, shouldTouch: false });
      setChallengeMayBeRequired(true);

      if (selection.challenge.kind === 'proof-of-work') {
        void solveActiveProofOfWork(selection.challenge);
      }
    } catch (error) {
      if (challengeStateRef.current) {
        clearActiveChallenge();
      }
      setErrorMessage(resolveAuthErrorPresentation(error).message);
    } finally {
      setIsBootstrappingChallenge(false);
    }
  };

  return {
    frameProps,
    formProps: {
      email: emailField.value,
      challengeAnswer: challengeAnswerField.value,
      emailInvalid: Boolean(form.formState.errors.email),
      challengeAnswerInvalid: Boolean(form.formState.errors.challengeAnswer),
      acceptedMessage,
      errorMessage,
      isSubmitting: form.formState.isSubmitting,
      isBootstrappingChallenge,
      challengeMayBeRequired,
      challengeState,
      resetPasswordHref: buildResetPasswordPath(undefined, redirectPath),
      onEmailChange: (value: string) => {
        emailField.onChange(value);
        form.clearErrors(['email', 'challengeAnswer']);
        setErrorMessage(null);
        setAcceptedMessage(null);
        setChallengeMayBeRequired(false);
        clearActiveChallenge();
      },
      onEmailBlur: emailField.onBlur,
      onChallengeAnswerChange: (value: string) => {
        challengeAnswerField.onChange(value);
        setErrorMessage(null);
      },
      onChallengeAnswerBlur: challengeAnswerField.onBlur,
      onBootstrapChallenge: handleBootstrapChallenge,
      onSubmit: () => {
        void handleSubmit();
      },
    },
  };
};
