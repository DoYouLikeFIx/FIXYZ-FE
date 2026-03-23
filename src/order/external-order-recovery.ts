export type ExternalOrderPresetId =
  | 'krx-buy-1'
  | 'krx-buy-2'
  | 'krx-buy-5'
  | 'krx-buy-10'
  | 'krx-market-buy-3';
export type ExternalOrderType = 'LIMIT' | 'MARKET';

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
  orderType: ExternalOrderType;
  quantity: number;
  price: number | null;
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
  orderType: ExternalOrderType;
  quantity: number;
  price: number | null;
}

const presetDefinitions: readonly ExternalOrderPresetDefinition[] = [
  {
    id: 'krx-buy-1',
    label: '1주',
    summary: '005930 · 1주 · 70,100원',
    symbol: '005930',
    side: 'BUY',
    orderType: 'LIMIT',
    quantity: 1,
    price: 70_100,
  },
  {
    id: 'krx-buy-2',
    label: '2주',
    summary: '005930 · 2주 · 70,100원',
    symbol: '005930',
    side: 'BUY',
    orderType: 'LIMIT',
    quantity: 2,
    price: 70_100,
  },
  {
    id: 'krx-buy-5',
    label: '5주',
    summary: '005930 · 5주 · 70,300원',
    symbol: '005930',
    side: 'BUY',
    orderType: 'LIMIT',
    quantity: 5,
    price: 70_300,
  },
  {
    id: 'krx-buy-10',
    label: '10주',
    summary: '005930 · 10주 · 70,500원',
    symbol: '005930',
    side: 'BUY',
    orderType: 'LIMIT',
    quantity: 10,
    price: 70_500,
  },
  {
    id: 'krx-market-buy-3',
    label: '시장가',
    summary: '005930 · 3주 · 시장가',
    symbol: '005930',
    side: 'BUY',
    orderType: 'MARKET',
    quantity: 3,
    price: null,
  },
] as const;

export const externalOrderPresetOptions: readonly ExternalOrderPresetOption[] =
  presetDefinitions.map(({ id, label, summary }) => ({
    id,
    label,
    summary,
  }));

export const externalOrderSupportedSymbols = {
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

const findMatchingPresetDefinition = (
  symbol: string,
  quantity: number | null,
  orderType: ExternalOrderType,
) =>
  presetDefinitions.find(
    (candidate) =>
      candidate.symbol === symbol
      && candidate.quantity === quantity
      && candidate.orderType === orderType,
  );

export const normalizeExternalOrderSymbol = (symbol: string) =>
  symbol.replace(/\s+/g, '').trim();

export const parseExternalOrderQuantity = (quantity: string) => {
  if (!/^\d+$/.test(quantity)) {
    return null;
  }

  const parsed = Number.parseInt(quantity, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    return null;
  }

  return parsed;
};

export const isSupportedExternalOrderSymbol = (symbol: string) =>
  symbol in externalOrderSupportedSymbols;

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

export const resolveExternalOrderTypeFromPresetId = (
  presetId?: ExternalOrderPresetId | null,
): ExternalOrderType =>
  presetId ? getPresetDefinition(presetId).orderType : defaultPreset.orderType;

export const matchPresetIdFromDraft = (
  draft: ExternalOrderDraft,
  options?: { orderType?: ExternalOrderType | null },
): ExternalOrderPresetId | null => {
  const normalizedSymbol = normalizeExternalOrderSymbol(draft.symbol);
  const parsedQuantity = parseExternalOrderQuantity(draft.quantity);
  const orderType = options?.orderType ?? 'LIMIT';

  return findMatchingPresetDefinition(normalizedSymbol, parsedQuantity, orderType)?.id ?? null;
};

export const resolveExternalOrderDraftSelection = (
  draft: ExternalOrderDraft,
  currentOrderType: ExternalOrderType,
): {
  presetId: ExternalOrderPresetId | null;
  orderType: ExternalOrderType;
} => {
  const normalizedSymbol = normalizeExternalOrderSymbol(draft.symbol);
  const parsedQuantity = parseExternalOrderQuantity(draft.quantity);
  const exactPreset = findMatchingPresetDefinition(
    normalizedSymbol,
    parsedQuantity,
    currentOrderType,
  );

  if (exactPreset) {
    return {
      presetId: exactPreset.id,
      orderType: exactPreset.orderType,
    };
  }

  return {
    presetId: findMatchingPresetDefinition(normalizedSymbol, parsedQuantity, 'LIMIT')?.id ?? null,
    orderType: 'LIMIT',
  };
};

export const buildExternalOrderDraftSummary = (
  draft: ExternalOrderDraft,
  options?: { orderType?: ExternalOrderType | null },
): string => {
  const normalizedSymbol = normalizeExternalOrderSymbol(draft.symbol);
  const parsedQuantity = parseExternalOrderQuantity(draft.quantity);
  const orderType = options?.orderType ?? 'LIMIT';
  const symbolLabel =
    externalOrderSupportedSymbols[normalizedSymbol as keyof typeof externalOrderSupportedSymbols]?.name;
  const summarySuffix = orderType === 'MARKET' ? ' · 시장가' : '';

  if (!normalizedSymbol && parsedQuantity === null) {
    return `종목코드와 수량을 입력해 주세요.${orderType === 'MARKET' ? ' 시장가 주문으로 준비 중입니다.' : ''}`;
  }

  if (!normalizedSymbol) {
    return `${parsedQuantity ?? '-'}주${summarySuffix}`;
  }

  if (parsedQuantity === null) {
    return `${normalizedSymbol}${symbolLabel ? ` · ${symbolLabel}` : ''}${summarySuffix}`;
  }

  return `${normalizedSymbol}${symbolLabel ? ` · ${symbolLabel}` : ''} · ${parsedQuantity}주${summarySuffix}`;
};

export const buildExternalOrderRequest = (input: {
  accountId?: string;
  symbol: string;
  quantity: string;
  orderType: ExternalOrderType;
}): ExternalOrderRequest | null => {
  const resolvedAccountId = resolveExternalOrderAccountId(input.accountId);
  if (resolvedAccountId === null) {
    return null;
  }

  const normalizedSymbol = normalizeExternalOrderSymbol(input.symbol);
  const parsedQuantity = parseExternalOrderQuantity(input.quantity);
  const symbolDefinition =
    externalOrderSupportedSymbols[normalizedSymbol as keyof typeof externalOrderSupportedSymbols];
  if (!symbolDefinition || parsedQuantity === null) {
    return null;
  }

  const orderType = input.orderType;
  const matchedPreset = findMatchingPresetDefinition(normalizedSymbol, parsedQuantity, orderType);

  if (orderType === 'MARKET' && matchedPreset?.orderType !== 'MARKET') {
    return null;
  }

  return {
    accountId: resolvedAccountId,
    clOrdId: createClOrdId(),
    symbol: normalizedSymbol,
    side: matchedPreset?.side ?? symbolDefinition.side,
    orderType,
    quantity: parsedQuantity,
    price: orderType === 'MARKET' ? null : matchedPreset?.price ?? symbolDefinition.price,
  };
};
