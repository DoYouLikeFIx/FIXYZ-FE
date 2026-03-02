import {
  DEFAULT_SERVER_ERROR_MESSAGE,
  type NormalizedApiError,
} from '@/lib/axios';

export const getErrorMessage = (error: unknown): string => {
  if (typeof error === 'string') {
    return error;
  }

  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof (error as Partial<NormalizedApiError>).message === 'string'
  ) {
    return (error as NormalizedApiError).message;
  }

  return DEFAULT_SERVER_ERROR_MESSAGE;
};
