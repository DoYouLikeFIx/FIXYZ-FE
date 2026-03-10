import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import {
  requestPasswordRecoveryChallenge,
  requestPasswordResetEmail,
} from '@/api/authApi';
import { useAuthTabsNavigation } from '@/hooks/auth/useAuthTabsNavigation';
import type { AuthFrameControllerProps } from '@/hooks/auth/controllerTypes';
import { resolveAuthErrorPresentation } from '@/lib/auth-errors';
import {
  createForgotPasswordFieldErrors,
  validateForgotPasswordForm,
} from '@/lib/schemas/auth.schema';
import type { PasswordRecoveryChallengeResponse } from '@/types/auth';

interface RecoveryChallengeState extends PasswordRecoveryChallengeResponse {
  email: string;
}

export const useForgotPasswordPageController = () => {
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState(searchParams.get('email') ?? '');
  const [challengeAnswer, setChallengeAnswer] = useState('');
  const [fieldErrors, setFieldErrors] = useState(createForgotPasswordFieldErrors);
  const [acceptedMessage, setAcceptedMessage] = useState<string | null>(null);
  const [challengeMayBeRequired, setChallengeMayBeRequired] = useState(false);
  const [challengeState, setChallengeState] = useState<RecoveryChallengeState | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isBootstrappingChallenge, setIsBootstrappingChallenge] = useState(false);
  const { displayMode, handleTabNavigation } = useAuthTabsNavigation('login');

  const normalizedChallengeEmail = challengeState?.email ?? email.trim();

  const frameProps: AuthFrameControllerProps = useMemo(() => ({
    displayMode,
    onLoginTabClick: handleTabNavigation('/login'),
    onRegisterTabClick: handleTabNavigation('/register'),
  }), [displayMode, handleTabNavigation]);

  const resetFlowState = () => {
    setAcceptedMessage(null);
    setChallengeMayBeRequired(false);
    setChallengeState(null);
    setChallengeAnswer('');
  };

  const clearStaleChallengeState = () => {
    setAcceptedMessage(null);
    setChallengeMayBeRequired(false);
    setChallengeState(null);
    setChallengeAnswer('');
  };

  const handleSubmit = async () => {
    setErrorMessage(null);
    const validation = validateForgotPasswordForm({
      email: normalizedChallengeEmail,
      requiresChallenge: Boolean(challengeState),
      challengeAnswer,
    });

    setFieldErrors(validation.fieldErrors);

    if (validation.message) {
      setErrorMessage(validation.message);
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await requestPasswordResetEmail({
        email: normalizedChallengeEmail,
        challengeAnswer: challengeState ? challengeAnswer.trim() : undefined,
        challengeToken: challengeState?.challengeToken,
      });

      setAcceptedMessage(response.message);
      setChallengeMayBeRequired(response.recovery.challengeMayBeRequired);
    } catch (error) {
      const presentation = resolveAuthErrorPresentation(error);

      if (challengeState) {
        clearStaleChallengeState();
      } else {
        setAcceptedMessage(null);
      }

      setErrorMessage(presentation.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleBootstrapChallenge = async () => {
    setErrorMessage(null);
    const validation = validateForgotPasswordForm({ email });

    setFieldErrors(validation.fieldErrors);

    if (validation.message) {
      setErrorMessage(validation.message);
      return;
    }

    setIsBootstrappingChallenge(true);

    try {
      const response = await requestPasswordRecoveryChallenge({
        email: email.trim(),
      });

      setChallengeState({
        ...response,
        email: email.trim(),
      });
      setChallengeMayBeRequired(true);
    } catch (error) {
      setErrorMessage(resolveAuthErrorPresentation(error).message);
    } finally {
      setIsBootstrappingChallenge(false);
    }
  };

  return {
    frameProps,
    formProps: {
      email,
      challengeAnswer,
      emailInvalid: fieldErrors.email,
      challengeAnswerInvalid: fieldErrors.challengeAnswer,
      acceptedMessage,
      errorMessage,
      isSubmitting,
      isBootstrappingChallenge,
      challengeMayBeRequired,
      challengeState,
      onEmailChange: (value: string) => {
        setEmail(value);
        setFieldErrors((current) => ({
          ...current,
          email: false,
          challengeAnswer: false,
        }));
        setErrorMessage(null);
        resetFlowState();
      },
      onChallengeAnswerChange: (value: string) => {
        setChallengeAnswer(value);
        setFieldErrors((current) => ({
          ...current,
          challengeAnswer: false,
        }));
        setErrorMessage(null);
      },
      onBootstrapChallenge: handleBootstrapChallenge,
      onSubmit: handleSubmit,
    },
  };
};
