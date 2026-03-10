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

export interface CsrfTokenPayload {
  csrfToken: string;
  headerName: string;
}

export interface SessionExpiryEventPayload {
  remainingSeconds: number;
}
