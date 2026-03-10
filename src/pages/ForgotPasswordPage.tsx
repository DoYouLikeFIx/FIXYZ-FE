import { AuthFrame } from '@/components/auth/AuthFrame';
import { ForgotPasswordForm } from '@/components/auth/ForgotPasswordForm';
import { useForgotPasswordPageController } from '@/hooks/auth/useForgotPasswordPageController';

export function ForgotPasswordPage() {
  const { frameProps, formProps } = useForgotPasswordPageController();

  return (
    <AuthFrame
      {...frameProps}
      mode="login"
      title={(
        <>
          비밀번호 재설정
          <br />
          요청
        </>
      )}
    >
      <ForgotPasswordForm {...formProps} />
    </AuthFrame>
  );
}
