import type { LanguageCode } from './i18n';

type GroupingStyle = 'western' | 'indian';

type AmountFormat = {
  groupSeparator: string;
  decimalSeparator: string;
  grouping: GroupingStyle;
};

export const NITO_AMOUNT_FORMATS: Record<LanguageCode, AmountFormat> = {
  en: { groupSeparator: ',', decimalSeparator: '.', grouping: 'western' },
  zh: { groupSeparator: ',', decimalSeparator: '.', grouping: 'western' },
  de: { groupSeparator: '.', decimalSeparator: ',', grouping: 'western' },
  es: { groupSeparator: '.', decimalSeparator: ',', grouping: 'western' },
  fr: { groupSeparator: '\u202f', decimalSeparator: ',', grouping: 'western' },
  ja: { groupSeparator: ',', decimalSeparator: '.', grouping: 'western' },
  tr: { groupSeparator: '.', decimalSeparator: ',', grouping: 'western' },
  pt: { groupSeparator: '.', decimalSeparator: ',', grouping: 'western' },
  ru: { groupSeparator: '\u202f', decimalSeparator: ',', grouping: 'western' },
};

const groupWesternDigits = (digits: string, separator: string) => {
  const groups: string[] = [];
  for (let end = digits.length; end > 0; end -= 3) {
    groups.unshift(digits.slice(Math.max(0, end - 3), end));
  }
  return groups.join(separator);
};

const groupIndianDigits = (digits: string, separator: string) => {
  if (digits.length <= 3) return digits;

  const groups = [digits.slice(-3)];
  let remaining = digits.slice(0, -3);
  while (remaining.length > 2) {
    groups.unshift(remaining.slice(-2));
    remaining = remaining.slice(0, -2);
  }
  if (remaining) groups.unshift(remaining);
  return groups.join(separator);
};

const groupIntegerDigits = (
  digits: string,
  { grouping, groupSeparator }: AmountFormat,
) => grouping === 'indian'
  ? groupIndianDigits(digits, groupSeparator)
  : groupWesternDigits(digits, groupSeparator);

export const formatNitoAmount = (
  satoshis: number | bigint,
  language: LanguageCode,
  {
    minimumFractionDigits = 0,
    maximumFractionDigits = 8,
    minusSign = '-',
  }: {
    minimumFractionDigits?: number;
    maximumFractionDigits?: number;
    minusSign?: '-' | '−';
  } = {},
) => {
  if (
    minimumFractionDigits < 0
    || maximumFractionDigits > 8
    || minimumFractionDigits > maximumFractionDigits
  ) {
    throw new Error('Invalid NITO fraction digit range.');
  }

  const normalized = typeof satoshis === 'bigint'
    ? satoshis
    : BigInt(Math.trunc(satoshis));
  const negative = normalized < 0n;
  const absolute = negative ? -normalized : normalized;
  const wholeDigits = (absolute / 100_000_000n).toString();
  const allFractionDigits = (absolute % 100_000_000n).toString().padStart(8, '0');
  let visibleFractionDigits = allFractionDigits.slice(0, maximumFractionDigits);

  while (
    visibleFractionDigits.length > minimumFractionDigits
    && visibleFractionDigits.endsWith('0')
  ) {
    visibleFractionDigits = visibleFractionDigits.slice(0, -1);
  }

  const format = NITO_AMOUNT_FORMATS[language];
  const groupedWhole = groupIntegerDigits(wholeDigits, format);
  const decimal = visibleFractionDigits
    ? `${format.decimalSeparator}${visibleFractionDigits}`
    : '';

  return `${negative ? minusSign : ''}${groupedWhole}${decimal}`;
};
