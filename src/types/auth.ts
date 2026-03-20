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

export interface TotpRebindBootstrap {
  rebindToken: string;
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

export interface MemberTotpRebindRequest {
  currentPassword: string;
}

export interface MfaRecoveryRebindRequest {
  recoveryProof: string;
}

export interface MfaRecoveryRebindConfirmRequest {
  rebindToken: string;
  enrollmentToken: string;
  otpCode: string;
}

export interface MfaRecoveryRebindConfirmResponse {
  rebindCompleted: boolean;
  reauthRequired: boolean;
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

export interface PasswordRecoveryChallengeLegacyResponse {
  challengeToken: string;
  challengeType: string;
  challengeTtlSeconds: number;
}

export interface PasswordRecoveryChallengeProofOfWorkPayload {
  kind: 'proof-of-work';
  proofOfWork: {
    algorithm: 'SHA-256';
    seed: string;
    difficultyBits: number;
    answerFormat: 'nonce-decimal';
    inputTemplate: '{seed}:{nonce}';
    inputEncoding: 'utf-8';
    successCondition: {
      type: 'leading-zero-bits';
      minimum: number;
    };
  };
}

export interface PasswordRecoveryChallengeV2Response
  extends PasswordRecoveryChallengeLegacyResponse {
  challengeContractVersion: 2;
  challengeId: string;
  challengeType: 'proof-of-work';
  challengeIssuedAtEpochMs: number;
  challengeExpiresAtEpochMs: number;
  challengePayload: PasswordRecoveryChallengeProofOfWorkPayload;
}

export type PasswordRecoveryChallengeResponse =
  | PasswordRecoveryChallengeLegacyResponse
  | PasswordRecoveryChallengeV2Response;

export interface PasswordRecoveryChallengeRequest {
  email: string;
}

export interface PasswordResetRequest {
  token: string;
  newPassword: string;
}

export interface PasswordResetContinuation {
  recoveryProof?: string;
  recoveryProofExpiresInSeconds?: number;
}

export interface CsrfTokenPayload {
  csrfToken: string;
  headerName: string;
}

export interface SessionExpiryEventPayload {
  remainingSeconds: number;
}
