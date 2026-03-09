export interface Member {
  memberUuid: string;
  username: string;
  email: string;
  name: string;
  role: string;
  totpEnrolled: boolean;
  accountId?: string;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface RegisterRequest extends LoginRequest {
  email: string;
  name: string;
}

export interface CsrfTokenPayload {
  csrfToken: string;
  headerName: string;
}

export interface SessionExpiryEventPayload {
  remainingSeconds: number;
}
