export const LOGIN_ROUTE = '/login';
export const DEFAULT_PROTECTED_ROUTE = '/portfolio';
export const FORGOT_PASSWORD_ROUTE = '/forgot-password';
export const RESET_PASSWORD_ROUTE = '/reset-password';
export const PASSWORD_RESET_SUCCESS_QUERY_KEY = 'recovery';
export const PASSWORD_RESET_SUCCESS_QUERY_VALUE = 'reset-success';
export const PASSWORD_RESET_SUCCESS_QUERY =
  `${PASSWORD_RESET_SUCCESS_QUERY_KEY}=${PASSWORD_RESET_SUCCESS_QUERY_VALUE}`;

export const buildRedirectPath = ({
  pathname,
  search,
  hash,
}: {
  pathname: string;
  search: string;
  hash: string;
}) => `${pathname}${search}${hash}`;

export const resolveRedirectTarget = (redirectParam: string | null | undefined) => {
  if (!redirectParam || !redirectParam.startsWith('/')) {
    return DEFAULT_PROTECTED_ROUTE;
  }

  if (
    redirectParam.startsWith('//') ||
    redirectParam.startsWith('/login') ||
    redirectParam.startsWith('/register') ||
    redirectParam.startsWith(FORGOT_PASSWORD_ROUTE) ||
    redirectParam.startsWith(RESET_PASSWORD_ROUTE)
  ) {
    return DEFAULT_PROTECTED_ROUTE;
  }

  return redirectParam;
};

export const buildLoginRedirect = (redirectPath: string) =>
  `${LOGIN_ROUTE}?redirect=${encodeURIComponent(redirectPath)}`;

export const buildPasswordResetSuccessLoginPath = () =>
  `${LOGIN_ROUTE}?${PASSWORD_RESET_SUCCESS_QUERY}`;

export const hasPasswordResetSuccessQuery = (
  searchParams: Pick<URLSearchParams, 'get'>,
) => searchParams.get(PASSWORD_RESET_SUCCESS_QUERY_KEY) === PASSWORD_RESET_SUCCESS_QUERY_VALUE;

export const buildForgotPasswordPath = (email?: string) => {
  const normalizedEmail = email?.trim();

  if (!normalizedEmail) {
    return FORGOT_PASSWORD_ROUTE;
  }

  return `${FORGOT_PASSWORD_ROUTE}?email=${encodeURIComponent(normalizedEmail)}`;
};

export const buildResetPasswordPath = (token?: string) => {
  const normalizedToken = token?.trim();

  if (!normalizedToken) {
    return RESET_PASSWORD_ROUTE;
  }

  return `${RESET_PASSWORD_ROUTE}?token=${encodeURIComponent(normalizedToken)}`;
};
