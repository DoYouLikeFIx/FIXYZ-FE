import { AuthFrame } from '@/components/auth/AuthFrame';
import { MfaRecoveryRebindForm } from '@/components/auth/MfaRecoveryRebindForm';
import { useMfaRecoveryRebindPageController } from '@/hooks/auth/useMfaRecoveryRebindPageController';

export function MfaRecoveryRebindPage() {
  const { frameProps, formProps } = useMfaRecoveryRebindPageController();

  return (
    <AuthFrame
      {...frameProps}
      mode="login"
      title={(
        <>
          새 authenticator
          <br />
          연결
        </>
      )}
    >
      <MfaRecoveryRebindForm {...formProps} />
    </AuthFrame>
  );
}
