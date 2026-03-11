import { AuthFrame } from '@/components/auth/AuthFrame';
import { PasswordResetForm } from '@/components/auth/PasswordResetForm';
import { useResetPasswordPageController } from '@/hooks/auth/useResetPasswordPageController';

export function PasswordResetPage() {
  const { frameProps, formProps } = useResetPasswordPageController();

  return (
    <AuthFrame
      {...frameProps}
      mode="login"
      title={(
        <>
          새 비밀번호
          <br />
          설정
        </>
      )}
    >
      <PasswordResetForm {...formProps} />
    </AuthFrame>
  );
}
