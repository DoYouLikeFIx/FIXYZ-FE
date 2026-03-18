import externalOrderErrorContract from '../../docs/contracts/external-order-error-ux.json';

export type OrderReasonCategory = 'validation' | 'internal' | 'external';

interface ReasonCategoryContract {
  name: OrderReasonCategory;
  codeFamilies?: string[];
  badgeLabel: string;
}

const ORDER_REASON_CATEGORIES = (
  externalOrderErrorContract.reasonCategories ?? []
) as ReasonCategoryContract[];

const CATEGORY_LABELS = ORDER_REASON_CATEGORIES.reduce<Record<OrderReasonCategory, string>>(
  (labels, category) => {
    labels[category.name] = category.badgeLabel;
    return labels;
  },
  {
    validation: '검증',
    internal: '내부',
    external: '대외',
  },
);

const FAMILY_TO_CATEGORY = ORDER_REASON_CATEGORIES.reduce<Record<string, OrderReasonCategory>>(
  (map, category) => {
    for (const family of category.codeFamilies ?? []) {
      map[family] = category.name;
    }
    return map;
  },
  {},
);

const normalizeErrorCode = (code?: string | null) =>
  typeof code === 'string' && /^[A-Z]+_[0-9]{3}$/.test(code)
    ? code.replace(/_/g, '-')
    : code ?? null;

const getCodeFamily = (code?: string | null) => {
  const normalized = normalizeErrorCode(code);
  if (!normalized) {
    return null;
  }

  const separatorIndex = normalized.indexOf('-');
  if (separatorIndex <= 0) {
    return normalized;
  }

  return normalized.slice(0, separatorIndex);
};

export const resolveOrderReasonCategory = (
  code?: string | null,
): OrderReasonCategory | null => {
  const family = getCodeFamily(code);
  if (!family) {
    return null;
  }

  return FAMILY_TO_CATEGORY[family] ?? null;
};

export const getOrderReasonCategoryLabel = (
  category?: OrderReasonCategory | null,
) => (category ? CATEGORY_LABELS[category] : null);
