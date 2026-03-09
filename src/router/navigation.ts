export const DEFAULT_PROTECTED_ROUTE = '/portfolio';

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
    redirectParam.startsWith('/register')
  ) {
    return DEFAULT_PROTECTED_ROUTE;
  }

  return redirectParam;
};

export const buildLoginRedirect = (redirectPath: string) =>
  `/login?redirect=${encodeURIComponent(redirectPath)}`;
