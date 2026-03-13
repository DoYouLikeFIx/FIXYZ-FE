import { AuthFrame } from '@/components/auth/AuthFrame';
import { MfaRecoveryEntryForm } from '@/components/auth/MfaRecoveryEntryForm';
import { useMfaRecoveryPageController } from '@/hooks/auth/useMfaRecoveryPageController';

export function MfaRecoveryPage() {
  const { frameProps, formProps } = useMfaRecoveryPageController();

  return (
    <AuthFrame
      {...frameProps}
      mode="login"
      title={(
        <>
          MFA 복구
          <br />
          시작
        </>
      )}
    >
      <MfaRecoveryEntryForm {...formProps} />
    </AuthFrame>
  );
}
