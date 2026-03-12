import { AuthFrame } from '@/components/auth/AuthFrame';
import { TotpEnrollmentForm } from '@/components/auth/TotpEnrollmentForm';
import { useTotpEnrollmentPageController } from '@/hooks/auth/useTotpEnrollmentPageController';

export function TotpEnrollmentPage() {
  const { frameProps, title, subtitle, formProps } =
    useTotpEnrollmentPageController();

  return (
    <AuthFrame
      {...frameProps}
      mode="login"
      title={(
        <>
          {title}
          <br />
          {subtitle}
        </>
      )}
    >
      <TotpEnrollmentForm {...formProps} />
    </AuthFrame>
  );
}
