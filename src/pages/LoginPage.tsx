import { AuthFrame } from '@/components/auth/AuthFrame';
import { LoginForm } from '@/components/auth/LoginForm';
import { useLoginPageController } from '@/hooks/auth/useLoginPageController';

export function LoginPage() {
  const { frameProps, formProps } = useLoginPageController();

  return (
    <AuthFrame
      {...frameProps}
      mode="login"
      title={(
        <>
          FIX 플랫폼에 오신 것을
          <br />
          환영합니다!
        </>
      )}
    >
      <LoginForm {...formProps} />
    </AuthFrame>
  );
}
