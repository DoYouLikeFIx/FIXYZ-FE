const STORAGE_KEY_PREFIX = 'fixyz.order-session-id:';

const getSessionStorage = () => {
  if (typeof window === 'undefined') {
    return null;
  }

  return window.sessionStorage;
};

const storageKey = (accountId: string) => `${STORAGE_KEY_PREFIX}${accountId}`;

export const persistOrderSessionId = (
  accountId: string | undefined,
  orderSessionId: string,
) => {
  if (!accountId) {
    return;
  }

  const sessionStorage = getSessionStorage();
  if (sessionStorage === null) {
    return;
  }

  sessionStorage.setItem(storageKey(accountId), orderSessionId);
};

export const readPersistedOrderSessionId = (accountId: string | undefined) => {
  if (!accountId) {
    return null;
  }

  const sessionStorage = getSessionStorage();
  if (sessionStorage === null) {
    return null;
  }

  return sessionStorage.getItem(storageKey(accountId));
};

export const clearPersistedOrderSessionId = (accountId: string | undefined) => {
  if (!accountId) {
    return;
  }

  const sessionStorage = getSessionStorage();
  if (sessionStorage === null) {
    return;
  }

  sessionStorage.removeItem(storageKey(accountId));
};

export const clearAllPersistedOrderSessionIds = () => {
  const sessionStorage = getSessionStorage();
  if (sessionStorage === null) {
    return;
  }

  const keysToDelete: string[] = [];
  for (let index = 0; index < sessionStorage.length; index += 1) {
    const key = sessionStorage.key(index);
    if (key && key.startsWith(STORAGE_KEY_PREFIX)) {
      keysToDelete.push(key);
    }
  }

  keysToDelete.forEach((key) => {
    sessionStorage.removeItem(key);
  });
};
