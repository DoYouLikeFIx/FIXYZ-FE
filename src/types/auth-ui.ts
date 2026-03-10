export type AuthMode = 'login' | 'register';

export interface LoginFieldErrors {
  email: boolean;
  password: boolean;
}

export interface RegisterFieldErrors {
  email: boolean;
  name: boolean;
  password: boolean;
  confirmPassword: boolean;
}
