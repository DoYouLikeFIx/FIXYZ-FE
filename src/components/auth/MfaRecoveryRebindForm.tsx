import { useEffect, useState, type FormEventHandler } from 'react';
import QRCode from 'qrcode';

interface MfaRecoveryRebindFormProps {
  qrUri: string;
  manualEntryKey: string;
  otpCode: string;
  expiresAtLabel: string;
  remainingLabel: string;
  isSubmitting: boolean;
  errorMessage: string | null;
  onOtpCodeChange: (value: string) => void;
  onOtpCodeBlur?: () => void;
  onRestartRecovery: () => void;
  onSubmit: FormEventHandler<HTMLFormElement>;
}

export function MfaRecoveryRebindForm({
  qrUri,
  manualEntryKey,
  otpCode,
  expiresAtLabel,
  remainingLabel,
  isSubmitting,
  errorMessage,
  onOtpCodeChange,
  onOtpCodeBlur,
  onRestartRecovery,
  onSubmit,
}: MfaRecoveryRebindFormProps) {
  const [qrCodeState, setQrCodeState] = useState<{
    dataUrl: string | null;
    source: string;
  }>({
    dataUrl: null,
    source: '',
  });

  useEffect(() => {
    if (!qrUri) {
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
          setQrCodeState({
            dataUrl: nextDataUrl,
            source: qrUri,
          });
        }
      })
      .catch(() => {
        if (active) {
          setQrCodeState({
            dataUrl: null,
            source: qrUri,
          });
        }
      });

    return () => {
      active = false;
    };
  }, [qrUri]);

  const qrCodeDataUrl = qrCodeState.source === qrUri
    ? qrCodeState.dataUrl
    : null;

  return (
    <form aria-busy={isSubmitting} className="auth-form auth-form--mfa" noValidate onSubmit={onSubmit}>
      <div className="totp-enroll-panel">
        <div className="totp-enroll-panel__section">
          <h2 className="totp-enroll-panel__title">새 authenticator 등록</h2>
          <p className="totp-enroll-panel__body">
            Google Authenticator 앱에서 새 계정을 추가하고 아래 QR 코드를 스캔해 주세요.
          </p>
          <div className="totp-enroll-qr" data-testid="mfa-recovery-qr">
            {qrCodeDataUrl ? (
              <img
                alt="MFA recovery rebind QR code"
                className="totp-enroll-qr__image"
                data-testid="mfa-recovery-qr-image"
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
          <code className="totp-enroll-manual-key" data-testid="mfa-recovery-manual-key">
            {manualEntryKey}
          </code>
          <p className="totp-enroll-panel__detail" data-testid="mfa-recovery-expiry">
            복구 단계 만료: {expiresAtLabel} · {remainingLabel}
          </p>
        </div>
      </div>

      <div className="field">
        <label className="field-label" htmlFor="mfa-recovery-code">
          현재 6자리 코드 확인
        </label>
        <input
          autoComplete="one-time-code"
          data-testid="mfa-recovery-code"
          id="mfa-recovery-code"
          inputMode="numeric"
          maxLength={6}
          name="otpCode"
          onBlur={onOtpCodeBlur}
          onChange={(event) => onOtpCodeChange(event.target.value)}
          pattern="[0-9]*"
          placeholder="6자리 코드"
          required
          value={otpCode}
        />
      </div>

      {errorMessage ? (
        <p className="form-message form-message--error" data-testid="mfa-recovery-confirm-error" role="alert">
          {errorMessage}
        </p>
      ) : null}

      <button
        className="auth-submit"
        data-testid="mfa-recovery-confirm-submit"
        disabled={isSubmitting}
        type="submit"
      >
        {isSubmitting ? '복구 확인 중...' : '새 authenticator 등록 완료'}
      </button>

      <button
        className="auth-secondary-action"
        data-testid="mfa-recovery-confirm-reset"
        type="button"
        onClick={onRestartRecovery}
      >
        복구 단계 처음부터 다시 시작
      </button>
    </form>
  );
}
