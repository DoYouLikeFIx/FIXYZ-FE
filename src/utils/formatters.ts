const krwFormatter = new Intl.NumberFormat('ko-KR', {
  style: 'currency',
  currency: 'KRW',
  maximumFractionDigits: 0,
});

const quantityFormatter = new Intl.NumberFormat('ko-KR', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 4,
});

const integerFormatter = new Intl.NumberFormat('ko-KR', {
  maximumFractionDigits: 0,
});

export const formatKRW = (amount: number) => krwFormatter.format(amount);

export const formatSignedKRW = (amount: number) => {
  if (amount > 0) {
    return `+${formatKRW(amount)}`;
  }

  if (amount < 0) {
    return `-${formatKRW(Math.abs(amount))}`;
  }

  return formatKRW(0);
};

export const formatQuantity = (amount: number) => quantityFormatter.format(amount);

export const formatInteger = (amount: number) => integerFormatter.format(amount);
