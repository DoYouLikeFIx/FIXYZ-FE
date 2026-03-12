import { useEffect, useState, type FormEventHandler } from 'react';
import QRCode from 'qrcode';

interface TotpEnrollmentFormProps {
  qrUri: string;
  manualEntryKey: string;
  otpCode: string;
  expiresAtLabel: string;
  remainingLabel: string;
  isLoadingBootstrap: boolean;
  isSubmitting: boolean;
  errorMessage: string | null;
  onOtpCodeChange: (value: string) => void;
  onRestartLogin: () => void;
  onSubmit: FormEventHandler<HTMLFormElement>;
}

export function TotpEnrollmentForm({
  qrUri,
  manualEntryKey,
  otpCode,
  expiresAtLabel,
  remainingLabel,
  isLoadingBootstrap,
  isSubmitting,
  errorMessage,
  onOtpCodeChange,
  onRestartLogin,
  onSubmit,
}: TotpEnrollmentFormProps) {
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!qrUri) {
      setQrCodeDataUrl(null);
      return;
    }

    let active = true;

    void QRCode.toDataURL(qrUri, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 192,
      color: {
        dark: '#0d182b',
        light: '#ffffffff',
      },
    })
      .then((nextDataUrl) => {
        if (active) {
          setQrCodeDataUrl(nextDataUrl);
        }
      })
      .catch(() => {
        if (active) {
          setQrCodeDataUrl(null);
        }
      });

    return () => {
      active = false;
    };
  }, [qrUri]);

  if (isLoadingBootstrap) {
    return (
      <div className="auth-inline-help auth-inline-help--mfa" data-testid="totp-enroll-loading" role="status">
        Google Authenticator 등록 정보를 준비하고 있습니다.
      </div>
    );
  }

  return (
    <form className="auth-form auth-form--mfa" noValidate onSubmit={onSubmit}>
      <div className="totp-enroll-panel">
        <div className="totp-enroll-panel__section">
          <h2 className="totp-enroll-panel__title">QR 등록 안내</h2>
          <p className="totp-enroll-panel__body">
            Google Authenticator 앱에서 새 계정을 추가하고 아래 QR 코드를 스캔해 주세요.
          </p>
          <div className="totp-enroll-qr" data-testid="totp-enroll-qr">
            {qrCodeDataUrl ? (
              <img
                alt="Google Authenticator enrollment QR code"
                className="totp-enroll-qr__image"
                data-testid="totp-enroll-qr-image"
                src={qrCodeDataUrl}
              />
            ) : (
              <p className="totp-enroll-panel__detail">
                QR 코드를 준비하지 못했습니다. 아래 수동 입력 키를 앱에 직접 입력해 주세요.
              </p>
            )}
          </div>
        </div>

        <div className="totp-enroll-panel__section">
          <h2 className="totp-enroll-panel__title">수동 입력 키</h2>
          <p className="totp-enroll-panel__body">
            QR 스캔이 어렵거나 QR가 보이지 않으면 아래 키를 앱에 직접 입력해 주세요.
          </p>
          <code className="totp-enroll-manual-key" data-testid="totp-enroll-manual-key">
            {manualEntryKey}
          </code>
          <p className="totp-enroll-panel__detail" data-testid="totp-enroll-expiry">
            인증 단계 만료: {expiresAtLabel} · {remainingLabel}
          </p>
        </div>
      </div>

      <div className="field">
        <label className="field-label" htmlFor="totp-enroll-code">
          첫 인증 코드 확인
        </label>
        <input
          autoComplete="one-time-code"
          data-testid="totp-enroll-code"
          id="totp-enroll-code"
          inputMode="numeric"
          maxLength={6}
          name="otpCode"
          onChange={(event) => onOtpCodeChange(event.target.value)}
          pattern="[0-9]*"
          placeholder="6자리 코드"
          required
          value={otpCode}
        />
      </div>

      {errorMessage ? (
        <p className="form-message form-message--error" data-testid="totp-enroll-error" role="alert">
          {errorMessage}
        </p>
      ) : null}

      <button
        className="auth-submit"
        data-testid="totp-enroll-submit"
        disabled={isSubmitting}
        type="submit"
      >
        {isSubmitting ? '등록 확인 중...' : '등록 확인'}
      </button>

      <button
        className="auth-secondary-action"
        data-testid="totp-enroll-reset"
        type="button"
        onClick={onRestartLogin}
      >
        비밀번호 다시 입력
      </button>
    </form>
  );
}
