export const LOGIN_ROUTE = '/login';
export const DEFAULT_PROTECTED_ROUTE = '/portfolio';
export const FORGOT_PASSWORD_ROUTE = '/forgot-password';
export const RESET_PASSWORD_ROUTE = '/reset-password';
export const TOTP_ENROLL_ROUTE = '/settings/totp/enroll';
export const MFA_RECOVERY_ROUTE = '/mfa-recovery';
export const MFA_RECOVERY_REBIND_ROUTE = '/mfa-recovery/rebind';
export const PASSWORD_RESET_SUCCESS_QUERY_KEY = 'recovery';
export const PASSWORD_RESET_SUCCESS_QUERY_VALUE = 'reset-success';
export const PASSWORD_RESET_SUCCESS_QUERY =
  `${PASSWORD_RESET_SUCCESS_QUERY_KEY}=${PASSWORD_RESET_SUCCESS_QUERY_VALUE}`;
export const ADMIN_ROUTE = '/admin';
export const MFA_RECOVERY_SUCCESS_QUERY_KEY = 'mfaRecovery';
export const MFA_RECOVERY_SUCCESS_QUERY_VALUE = 'rebound';
export const MFA_RECOVERY_SUCCESS_QUERY =
  `${MFA_RECOVERY_SUCCESS_QUERY_KEY}=${MFA_RECOVERY_SUCCESS_QUERY_VALUE}`;

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
    redirectParam.startsWith(RESET_PASSWORD_ROUTE) ||
    redirectParam.startsWith(MFA_RECOVERY_ROUTE) ||
    redirectParam.startsWith(MFA_RECOVERY_REBIND_ROUTE) ||
    redirectParam.startsWith(TOTP_ENROLL_ROUTE)
  ) {
    return DEFAULT_PROTECTED_ROUTE;
  }

  return redirectParam;
};

export const buildLoginRedirect = (redirectPath: string) =>
  `${LOGIN_ROUTE}?redirect=${encodeURIComponent(redirectPath)}`;

export const resolveTotpEnrollmentRoute = (routePath: string | null | undefined) => {
  if (!routePath) {
    return TOTP_ENROLL_ROUTE;
  }

  try {
    const parsed = new URL(routePath, 'http://localhost');

    if (parsed.origin !== 'http://localhost' || parsed.pathname !== TOTP_ENROLL_ROUTE) {
      return TOTP_ENROLL_ROUTE;
    }

    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return TOTP_ENROLL_ROUTE;
  }
};

export const buildRouteWithRedirect = (routePath: string, redirectPath: string) => {
  const [pathnameAndSearch, hash = ''] = routePath.split('#', 2);
  const [pathname, search = ''] = pathnameAndSearch.split('?', 2);
  const searchParams = new URLSearchParams(search);

  searchParams.set('redirect', resolveRedirectTarget(redirectPath));

  const nextSearch = searchParams.toString();

  return `${pathname}${nextSearch ? `?${nextSearch}` : ''}${hash ? `#${hash}` : ''}`;
};

export const buildTotpEnrollmentRedirect = (redirectPath: string) =>
  buildRouteWithRedirect(TOTP_ENROLL_ROUTE, redirectPath);

const appendOptionalRedirect = (routePath: string, redirectPath?: string) =>
  redirectPath && redirectPath.trim()
    ? buildRouteWithRedirect(routePath, redirectPath)
    : routePath;

export const buildPasswordResetSuccessLoginPath = (redirectPath?: string) =>
  appendOptionalRedirect(`${LOGIN_ROUTE}?${PASSWORD_RESET_SUCCESS_QUERY}`, redirectPath);

export const buildMfaRecoverySuccessLoginPath = (redirectPath?: string) =>
  appendOptionalRedirect(`${LOGIN_ROUTE}?${MFA_RECOVERY_SUCCESS_QUERY}`, redirectPath);

export const hasPasswordResetSuccessQuery = (
  searchParams: Pick<URLSearchParams, 'get'>,
) => searchParams.get(PASSWORD_RESET_SUCCESS_QUERY_KEY) === PASSWORD_RESET_SUCCESS_QUERY_VALUE;

export const hasMfaRecoverySuccessQuery = (
  searchParams: Pick<URLSearchParams, 'get'>,
) => searchParams.get(MFA_RECOVERY_SUCCESS_QUERY_KEY) === MFA_RECOVERY_SUCCESS_QUERY_VALUE;

export const buildForgotPasswordPath = (email?: string, redirectPath?: string) => {
  const normalizedEmail = email?.trim();

  return appendOptionalRedirect(
    normalizedEmail
      ? `${FORGOT_PASSWORD_ROUTE}?email=${encodeURIComponent(normalizedEmail)}`
      : FORGOT_PASSWORD_ROUTE,
    redirectPath,
  );
};

export const buildMfaRecoveryPath = (email?: string, redirectPath?: string) => {
  const normalizedEmail = email?.trim();

  return appendOptionalRedirect(
    normalizedEmail
      ? `${MFA_RECOVERY_ROUTE}?email=${encodeURIComponent(normalizedEmail)}`
      : MFA_RECOVERY_ROUTE,
    redirectPath,
  );
};

export const resolveMfaRecoveryRoute = (routePath: string | null | undefined) => {
  if (!routePath) {
    return MFA_RECOVERY_ROUTE;
  }

  try {
    const parsed = new URL(routePath, 'http://localhost');

    if (parsed.origin !== 'http://localhost' || parsed.pathname !== MFA_RECOVERY_ROUTE) {
      return MFA_RECOVERY_ROUTE;
    }

    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return MFA_RECOVERY_ROUTE;
  }
};

export const buildMfaRecoveryRebindPath = (redirectPath?: string) =>
  appendOptionalRedirect(MFA_RECOVERY_REBIND_ROUTE, redirectPath);

export const buildResetPasswordPath = (token?: string, redirectPath?: string) => {
  const normalizedToken = token?.trim();

  return appendOptionalRedirect(
    normalizedToken
      ? `${RESET_PASSWORD_ROUTE}?token=${encodeURIComponent(normalizedToken)}`
      : RESET_PASSWORD_ROUTE,
    redirectPath,
  );
};
