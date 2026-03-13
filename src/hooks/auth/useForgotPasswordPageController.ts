import { useMemo, useState } from 'react';
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
  forgotPasswordSchema,
  type ForgotPasswordFormValues,
} from '@/lib/schemas/auth.schema';
import {
  buildResetPasswordPath,
  resolveRedirectTarget,
} from '@/router/navigation';
import type { PasswordRecoveryChallengeResponse } from '@/types/auth';

interface RecoveryChallengeState extends PasswordRecoveryChallengeResponse {
  email: string;
}

export const useForgotPasswordPageController = () => {
  const [searchParams] = useSearchParams();
  const redirectPath = searchParams.get('redirect')
    ? resolveRedirectTarget(searchParams.get('redirect'))
    : undefined;
  const [acceptedMessage, setAcceptedMessage] = useState<string | null>(null);
  const [challengeMayBeRequired, setChallengeMayBeRequired] = useState(false);
  const [challengeState, setChallengeState] = useState<RecoveryChallengeState | null>(null);
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

  const normalizedChallengeEmail = challengeState?.email ?? emailField.value.trim();

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

  const resetFlowState = () => {
    setAcceptedMessage(null);
    setChallengeMayBeRequired(false);
    setChallengeState(null);
    resetChallengeField();
  };

  const clearActiveChallenge = () => {
    setChallengeState(null);
    resetChallengeField();
  };

  const clearStaleChallengeState = () => {
    resetFlowState();
  };

  const handleSubmit = form.handleSubmit(async (values) => {
    setErrorMessage(null);

    try {
      const response = await requestPasswordResetEmail({
        email: normalizedChallengeEmail,
        challengeAnswer: challengeState ? values.challengeAnswer.trim() : undefined,
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
      const response = await requestPasswordRecoveryChallenge({
        email: emailField.value.trim(),
      });

      setChallengeState({
        ...response,
        email: emailField.value.trim(),
      });
      resetChallengeField();
      form.setValue('requiresChallenge', true, { shouldDirty: false, shouldTouch: false });
      setChallengeMayBeRequired(true);
    } catch (error) {
      if (challengeState) {
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
        resetFlowState();
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
