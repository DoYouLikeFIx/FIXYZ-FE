import { useState, type FormEventHandler } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { registerMember, startLoginFlow } from '@/api/authApi';
import { useAuth } from '@/hooks/auth/useAuth';
import { useAuthTabsNavigation } from '@/hooks/auth/useAuthTabsNavigation';
import { useRegisterFormState } from '@/hooks/auth/useRegisterFormState';
import type { AuthFrameControllerProps } from '@/hooks/auth/controllerTypes';
import { getAuthErrorMessage } from '@/lib/auth-errors';
import {
  buildLoginRedirect,
  buildTotpEnrollmentRedirect,
  resolveRedirectTarget,
} from '@/router/navigation';
export const useRegisterPageController = () => {
  const clearReauthMessage = useAuth((state) => state.clearReauthMessage);
  const startMfaChallenge = useAuth((state) => state.startMfaChallenge);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const registerForm = useRegisterFormState();
  const { displayMode, handleTabNavigation } = useAuthTabsNavigation('register');

  const handleSubmit: FormEventHandler<HTMLFormElement> = async (event) => {
    event.preventDefault();
    setErrorMessage(null);
    clearReauthMessage();

    const validationResult = registerForm.validate();

    if (validationResult) {
      setErrorMessage(validationResult.message);
      return;
    }

    setIsSubmitting(true);

    try {
      const registrationPayload = registerForm.getPayload();

      await registerMember(registrationPayload);

      const challenge = await startLoginFlow({
        email: registrationPayload.email,
        password: registrationPayload.password,
      });

      const redirectPath = resolveRedirectTarget(searchParams.get('redirect'));

      startMfaChallenge(
        challenge,
        redirectPath,
      );

      navigate(
        challenge.nextAction === 'ENROLL_TOTP'
          ? buildTotpEnrollmentRedirect(redirectPath)
          : buildLoginRedirect(redirectPath),
        {
          replace: true,
        },
      );
    } catch (error) {
      setErrorMessage(getAuthErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  };

  const frameProps: AuthFrameControllerProps = {
    displayMode,
    onLoginTabClick: handleTabNavigation('/login'),
    onRegisterTabClick: handleTabNavigation('/register'),
  };

  return {
    frameProps,
    formProps: {
      email: registerForm.email,
      name: registerForm.name,
      password: registerForm.password,
      confirmPassword: registerForm.confirmPassword,
      showPassword: registerForm.showPassword,
      showConfirmPassword: registerForm.showConfirmPassword,
      emailInvalid: registerForm.fieldErrors.email,
      nameInvalid: registerForm.fieldErrors.name,
      passwordInvalid: registerForm.fieldErrors.password,
      confirmPasswordInvalid: registerForm.fieldErrors.confirmPassword,
      isPasswordValid: registerForm.isPasswordValid,
      isConfirmDirty: registerForm.isConfirmDirty,
      isConfirmPasswordValid: registerForm.isConfirmPasswordValid,
      passwordPolicyMessage: registerForm.passwordPolicyMessage,
      confirmPasswordMessage: registerForm.confirmPasswordMessage,
      errorMessage,
      isSubmitting,
      onEmailChange: (value: string) => {
        setErrorMessage(null);
        registerForm.setEmail(value);
      },
      onNameChange: (value: string) => {
        setErrorMessage(null);
        registerForm.setName(value);
      },
      onPasswordChange: (value: string) => {
        setErrorMessage(null);
        registerForm.setPassword(value);
      },
      onConfirmPasswordChange: (value: string) => {
        setErrorMessage(null);
        registerForm.setConfirmPassword(value);
      },
      onTogglePasswordVisibility: registerForm.togglePasswordVisibility,
      onToggleConfirmPasswordVisibility:
        registerForm.toggleConfirmPasswordVisibility,
      onSubmit: handleSubmit,
    },
  };
};
