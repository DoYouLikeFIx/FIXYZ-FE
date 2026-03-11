export type ExternalOrderPresetId =
  | 'krx-buy-1'
  | 'krx-buy-2'
  | 'krx-buy-5'
  | 'krx-buy-10';

export interface ExternalOrderPresetOption {
  id: ExternalOrderPresetId;
  label: string;
  summary: string;
}

export interface ExternalOrderRequest {
  accountId: number;
  clOrdId: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  price: number;
}

interface ExternalOrderPresetDefinition extends ExternalOrderPresetOption {
  symbol: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  price: number;
}

const presetDefinitions: readonly ExternalOrderPresetDefinition[] = [
  {
    id: 'krx-buy-1',
    label: '1주',
    summary: '005930 · 1주 · 70,100원',
    symbol: '005930',
    side: 'BUY',
    quantity: 1,
    price: 70_100,
  },
  {
    id: 'krx-buy-2',
    label: '2주',
    summary: '005930 · 2주 · 70,100원',
    symbol: '005930',
    side: 'BUY',
    quantity: 2,
    price: 70_100,
  },
  {
    id: 'krx-buy-5',
    label: '5주',
    summary: '005930 · 5주 · 70,300원',
    symbol: '005930',
    side: 'BUY',
    quantity: 5,
    price: 70_300,
  },
  {
    id: 'krx-buy-10',
    label: '10주',
    summary: '005930 · 10주 · 70,500원',
    symbol: '005930',
    side: 'BUY',
    quantity: 10,
    price: 70_500,
  },
] as const;

export const externalOrderPresetOptions: readonly ExternalOrderPresetOption[] =
  presetDefinitions.map(({ id, label, summary }) => ({
    id,
    label,
    summary,
  }));

const getPresetDefinition = (
  presetId: ExternalOrderPresetId,
): ExternalOrderPresetDefinition =>
  presetDefinitions.find((preset) => preset.id === presetId)
  ?? presetDefinitions[0];

const createFallbackUuid = () =>
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    const value = character === 'x' ? random : ((random & 0x3) | 0x8);
    return value.toString(16);
  });

const createClOrdId = () => {
  if (
    typeof globalThis.crypto !== 'undefined'
    && typeof globalThis.crypto.randomUUID === 'function'
  ) {
    return globalThis.crypto.randomUUID();
  }

  return createFallbackUuid();
};

const parseNumericOrderAccountId = (accountId: string): number | null => {
  if (!/^\d+$/.test(accountId)) {
    return null;
  }

  const parsed = Number(accountId);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
};

export const resolveExternalOrderAccountId = (
  accountId?: string,
): number | null => {
  if (!accountId) {
    return null;
  }

  return parseNumericOrderAccountId(accountId);
};

export const hasExternalOrderAccountId = (accountId?: string) =>
  resolveExternalOrderAccountId(accountId) !== null;

export const buildExternalOrderRequest = (input: {
  accountId?: string;
  presetId: ExternalOrderPresetId;
}): ExternalOrderRequest | null => {
  const resolvedAccountId = resolveExternalOrderAccountId(input.accountId);
  if (resolvedAccountId === null) {
    return null;
  }

  const preset = getPresetDefinition(input.presetId);

  return {
    accountId: resolvedAccountId,
    clOrdId: createClOrdId(),
    symbol: preset.symbol,
    side: preset.side,
    quantity: preset.quantity,
    price: preset.price,
  };
};
