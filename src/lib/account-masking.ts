const DIGITS_ONLY_PATTERN = /\D/g;

export const maskAccountNumber = (value?: string | null) => {
  const digits = value?.replace(DIGITS_ONLY_PATTERN, '') ?? '';

  if (!digits) {
    return '계좌 연동 대기';
  }

  if (digits.length >= 8) {
    return `${digits.slice(0, 3)}-****-${digits.slice(-4)}`;
  }

  return `***-${digits.slice(-4).padStart(4, '*')}`;
};
