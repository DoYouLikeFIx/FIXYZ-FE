export interface Member {
  memberUuid: string;
  email: string;
  name: string;
  role: string;
  totpEnrolled: boolean;
  accountId?: string;
}

export interface LoginRequest {
  email: string;
  password: string;
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
