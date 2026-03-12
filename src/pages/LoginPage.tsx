import { AuthFrame } from '@/components/auth/AuthFrame';
import { LoginMfaForm } from '@/components/auth/LoginMfaForm';
import { LoginForm } from '@/components/auth/LoginForm';
import { useLoginPageController } from '@/hooks/auth/useLoginPageController';

export function LoginPage() {
  const {
    frameProps,
    formProps,
    isMfaStep,
    mfaFormProps,
    titleLines,
  } = useLoginPageController();

  return (
    <AuthFrame
      {...frameProps}
      mode="login"
      title={(
        <>
          {titleLines[0]}
          {titleLines[1] ? (
            <>
              <br />
              {titleLines[1]}
            </>
          ) : null}
        </>
      )}
    >
      {isMfaStep ? <LoginMfaForm {...mfaFormProps} /> : <LoginForm {...formProps} />}
    </AuthFrame>
  );
}
