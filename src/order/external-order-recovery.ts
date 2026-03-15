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

export interface ExternalOrderDraft {
  symbol: string;
  quantity: string;
}

export interface ExternalOrderFieldErrors {
  symbol?: string;
  quantity?: string;
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

const supportedSymbols = {
  '005930': {
    name: '삼성전자',
    price: 70_100,
    side: 'BUY' as const,
  },
  '000660': {
    name: 'SK하이닉스',
    price: 194_000,
    side: 'BUY' as const,
  },
  '035420': {
    name: 'NAVER',
    price: 223_000,
    side: 'BUY' as const,
  },
} as const;

const defaultPreset = presetDefinitions[0];

const getPresetDefinition = (
  presetId: ExternalOrderPresetId,
): ExternalOrderPresetDefinition =>
  presetDefinitions.find((preset) => preset.id === presetId)
  ?? presetDefinitions[0];

const normalizeSymbol = (symbol: string) =>
  symbol.replace(/\s+/g, '').trim();

const parseQuantity = (quantity: string) => {
  if (!/^\d+$/.test(quantity)) {
    return null;
  }

  const parsed = Number.parseInt(quantity, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    return null;
  }

  return parsed;
};

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

export const createInitialExternalOrderDraft = (): ExternalOrderDraft => ({
  symbol: defaultPreset.symbol,
  quantity: String(defaultPreset.quantity),
});

export const draftFromPreset = (
  presetId: ExternalOrderPresetId,
): ExternalOrderDraft => {
  const preset = getPresetDefinition(presetId);

  return {
    symbol: preset.symbol,
    quantity: String(preset.quantity),
  };
};

export const matchPresetIdFromDraft = (
  draft: ExternalOrderDraft,
): ExternalOrderPresetId | null => {
  const normalizedSymbol = normalizeSymbol(draft.symbol);
  const parsedQuantity = parseQuantity(draft.quantity);
  const preset = presetDefinitions.find(
    (candidate) =>
      candidate.symbol === normalizedSymbol
      && candidate.quantity === parsedQuantity,
  );

  return preset?.id ?? null;
};

export const validateExternalOrderDraft = (
  draft: ExternalOrderDraft,
): ExternalOrderFieldErrors => {
  const errors: ExternalOrderFieldErrors = {};
  const normalizedSymbol = normalizeSymbol(draft.symbol);

  if (!normalizedSymbol) {
    errors.symbol = '종목코드를 입력해 주세요.';
  } else if (!/^\d{6}$/.test(normalizedSymbol)) {
    errors.symbol = '종목코드는 숫자 6자리여야 합니다.';
  } else if (!(normalizedSymbol in supportedSymbols)) {
    errors.symbol = '지원하지 않는 종목코드입니다.';
  }

  if (!draft.quantity.trim()) {
    errors.quantity = '수량을 입력해 주세요.';
  } else if (!/^\d+$/.test(draft.quantity)) {
    errors.quantity = '수량은 1 이상의 정수여야 합니다.';
  } else if (parseQuantity(draft.quantity) === null) {
    errors.quantity = '수량은 1 이상의 정수여야 합니다.';
  }

  return errors;
};

export const buildExternalOrderDraftSummary = (
  draft: ExternalOrderDraft,
): string => {
  const normalizedSymbol = normalizeSymbol(draft.symbol);
  const parsedQuantity = parseQuantity(draft.quantity);
  const symbolLabel = supportedSymbols[normalizedSymbol as keyof typeof supportedSymbols]?.name;

  if (!normalizedSymbol && parsedQuantity === null) {
    return '종목코드와 수량을 입력해 주세요.';
  }

  if (!normalizedSymbol) {
    return `${parsedQuantity ?? '-'}주`;
  }

  if (parsedQuantity === null) {
    return `${normalizedSymbol}${symbolLabel ? ` · ${symbolLabel}` : ''}`;
  }

  return `${normalizedSymbol}${symbolLabel ? ` · ${symbolLabel}` : ''} · ${parsedQuantity}주`;
};

export const buildExternalOrderRequest = (input: {
  accountId?: string;
  symbol: string;
  quantity: string;
}): ExternalOrderRequest | null => {
  const resolvedAccountId = resolveExternalOrderAccountId(input.accountId);
  if (resolvedAccountId === null) {
    return null;
  }

  const normalizedSymbol = normalizeSymbol(input.symbol);
  const parsedQuantity = parseQuantity(input.quantity);
  const symbolDefinition = supportedSymbols[normalizedSymbol as keyof typeof supportedSymbols];
  if (!symbolDefinition || parsedQuantity === null) {
    return null;
  }

  return {
    accountId: resolvedAccountId,
    clOrdId: createClOrdId(),
    symbol: normalizedSymbol,
    side: symbolDefinition.side,
    quantity: parsedQuantity,
    price: symbolDefinition.price,
  };
};
