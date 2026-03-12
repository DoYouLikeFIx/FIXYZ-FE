export interface Member {
  memberUuid: string;
  email: string;
  name: string;
  role: string;
  totpEnrolled: boolean;
  accountId?: string;
}

export type MfaNextAction = 'VERIFY_TOTP' | 'ENROLL_TOTP';

export interface LoginChallenge {
  loginToken: string;
  nextAction: MfaNextAction;
  totpEnrolled: boolean;
  expiresAt: string;
}

export interface TotpEnrollmentBootstrap {
  qrUri: string;
  manualEntryKey: string;
  enrollmentToken: string;
  expiresAt: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface TotpVerificationRequest {
  loginToken: string;
  otpCode: string;
}

export interface TotpEnrollmentRequest {
  loginToken: string;
}

export interface TotpEnrollmentConfirmationRequest {
  loginToken: string;
  enrollmentToken: string;
  otpCode: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
  name: string;
}

export interface PasswordForgotRequest {
  email: string;
  challengeToken?: string;
  challengeAnswer?: string;
}

export interface PasswordRecoveryMetadata {
  challengeEndpoint: string;
  challengeMayBeRequired: boolean;
}

export interface PasswordForgotResponse {
  accepted: boolean;
  message: string;
  recovery: PasswordRecoveryMetadata;
}

export interface PasswordRecoveryChallengeRequest {
  email: string;
}

export interface PasswordRecoveryChallengeResponse {
  challengeToken: string;
  challengeType: string;
  challengeTtlSeconds: number;
}

export interface PasswordResetRequest {
  token: string;
  newPassword: string;
}

export interface CsrfTokenPayload {
  csrfToken: string;
  headerName: string;
}

export interface SessionExpiryEventPayload {
  remainingSeconds: number;
}
