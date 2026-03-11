import { getErrorMessage } from '@/lib/errors';

export const ACCOUNT_DASHBOARD_RETRY_GUIDANCE =
  '페이지를 새로고침한 뒤 다시 시도해 주세요. 문제가 계속되면 고객센터에 문의해 주세요.';

export interface AccountDashboardErrorPresentation {
  message: string;
  nextStep: string;
}

export const getAccountDashboardErrorPresentation = (
  error: unknown,
): AccountDashboardErrorPresentation => ({
  message: getErrorMessage(error),
  nextStep: ACCOUNT_DASHBOARD_RETRY_GUIDANCE,
});
