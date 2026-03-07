import { AuthFrame } from '@/components/auth/AuthFrame';
import { RegisterForm } from '@/components/auth/RegisterForm';
import { useRegisterPageController } from '@/hooks/auth/useRegisterPageController';

export function RegisterPage() {
  const { frameProps, formProps } = useRegisterPageController();

  return (
    <AuthFrame
      {...frameProps}
      mode="register"
      title={(
        <>
          FIX 플랫폼
          <br />
          회원가입
        </>
      )}
    >
      <RegisterForm {...formProps} />
    </AuthFrame>
  );
}
