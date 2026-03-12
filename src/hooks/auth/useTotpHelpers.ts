import { useEffect, useState } from 'react';

const formatDateTime = (isoTimestamp: string) => {
  const date = new Date(isoTimestamp);

  if (Number.isNaN(date.getTime())) {
    return '만료 시간을 확인할 수 없습니다.';
  }

  return new Intl.DateTimeFormat('ko-KR', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
};

const formatRemaining = (remainingSeconds: number) => {
  if (remainingSeconds <= 0) {
    return '인증 단계가 만료되었습니다.';
  }

  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;

  return `${minutes}분 ${String(seconds).padStart(2, '0')}초 남음`;
};

const getRemainingSeconds = (expiresAt: string) => {
  const expiresAtMs = new Date(expiresAt).getTime();

  if (Number.isNaN(expiresAtMs)) {
    return 0;
  }

  return Math.max(0, Math.ceil((expiresAtMs - Date.now()) / 1000));
};

export const useExpiryCountdown = (expiresAt: string) => {
  const [remainingSeconds, setRemainingSeconds] = useState(() =>
    getRemainingSeconds(expiresAt),
  );

  useEffect(() => {
    const syncRemaining = () => {
      setRemainingSeconds(getRemainingSeconds(expiresAt));
    };

    const initialTimer = window.setTimeout(syncRemaining, 0);
    const timer = window.setInterval(() => {
      syncRemaining();
    }, 1000);

    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(timer);
    };
  }, [expiresAt]);

  return {
    expiresAtLabel: formatDateTime(expiresAt),
    remainingLabel: formatRemaining(remainingSeconds),
    isExpired: remainingSeconds === 0,
  };
};

export const sanitizeOtpCodeInput = (value: string) =>
  value.replace(/\D/g, '').slice(0, 6);

export const isCompleteOtpCode = (value: string) =>
  /^\d{6}$/.test(value);
