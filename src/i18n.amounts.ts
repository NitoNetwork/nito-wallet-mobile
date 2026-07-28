import type { LanguageCode } from './i18n';

type AmountFormat = {
  groupSeparator: string;
  decimalSeparator: string;
};

export const NITO_AMOUNT_FORMATS: Record<LanguageCode, AmountFormat> = {
  en: { groupSeparator: ',', decimalSeparator: '.' },
  zh: { groupSeparator: ',', decimalSeparator: '.' },
  de: { groupSeparator: '.', decimalSeparator: ',' },
  es: { groupSeparator: '.', decimalSeparator: ',' },
  fr: { groupSeparator: '\u202f', decimalSeparator: ',' },
  ja: { groupSeparator: ',', decimalSeparator: '.' },
  tr: { groupSeparator: '.', decimalSeparator: ',' },
  pt: { groupSeparator: '.', decimalSeparator: ',' },
  ru: { groupSeparator: '\u202f', decimalSeparator: ',' },
};

const groupWesternDigits = (digits: string, separator: string) => {
  const groups: string[] = [];
  for (let end = digits.length; end > 0; end -= 3) {
    groups.unshift(digits.slice(Math.max(0, end - 3), end));
  }
  return groups.join(separator);
};

const groupIntegerDigits = (
  digits: string,
  { groupSeparator }: AmountFormat,
) => groupWesternDigits(digits, groupSeparator);

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
