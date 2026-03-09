export type AuthMode = 'login' | 'register';

export interface LoginFieldErrors {
  username: boolean;
  password: boolean;
}

export interface RegisterFieldErrors {
  username: boolean;
  email: boolean;
  name: boolean;
  password: boolean;
  confirmPassword: boolean;
}
