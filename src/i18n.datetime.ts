import type { LanguageCode } from './i18n';

/**
 * Block times arrive as Unix timestamps, which are absolute instants rather
 * than a reading of some server clock. Rendering them with the device's local
 * getters therefore yields the correct local moment whatever Electrum server
 * produced them — official or self hosted — with nothing to negotiate.
 *
 * The layout comes from a fixed table rather than toLocaleDateString: Hermes
 * ships incomplete Intl locale data on Android, and a silent fallback to the
 * English layout would be invisible in tests and wrong on the device.
 */
type DateOrder = 'dmy' | 'mdy' | 'ymd';

type DateTimeFormat = {
  order: DateOrder;
  dateSeparator: string;
  timeSeparator: string;
  hour12: boolean;
};

export const NITO_DATE_FORMATS: Readonly<Record<LanguageCode, DateTimeFormat>> = {
  en: { order: 'mdy', dateSeparator: '/', timeSeparator: ':', hour12: true },
  zh: { order: 'ymd', dateSeparator: '/', timeSeparator: ':', hour12: false },
  ja: { order: 'ymd', dateSeparator: '/', timeSeparator: ':', hour12: false },
  es: { order: 'dmy', dateSeparator: '/', timeSeparator: ':', hour12: false },
  fr: { order: 'dmy', dateSeparator: '/', timeSeparator: 'h', hour12: false },
  de: { order: 'dmy', dateSeparator: '.', timeSeparator: ':', hour12: false },
  tr: { order: 'dmy', dateSeparator: '.', timeSeparator: ':', hour12: false },
  pt: { order: 'dmy', dateSeparator: '/', timeSeparator: ':', hour12: false },
  ru: { order: 'dmy', dateSeparator: '.', timeSeparator: ':', hour12: false },
};

const pad = (value: number) => String(value).padStart(2, '0');

export const formatNitoDate = (blockTime: number, language: LanguageCode): string => {
  const format = NITO_DATE_FORMATS[language];
  const at = new Date(blockTime * 1000);
  const day = pad(at.getDate());
  const month = pad(at.getMonth() + 1);
  const year = String(at.getFullYear());

  if (format.order === 'mdy') return [month, day, year].join(format.dateSeparator);
  if (format.order === 'ymd') return [year, month, day].join(format.dateSeparator);
  return [day, month, year].join(format.dateSeparator);
};

export const formatNitoTime = (blockTime: number, language: LanguageCode): string => {
  const format = NITO_DATE_FORMATS[language];
  const at = new Date(blockTime * 1000);
  const minutes = pad(at.getMinutes());

  if (!format.hour12) return `${pad(at.getHours())}${format.timeSeparator}${minutes}`;

  const hours = at.getHours();
  const suffix = hours < 12 ? 'AM' : 'PM';
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${hour12}${format.timeSeparator}${minutes} ${suffix}`;
};

/** Time first, then date, matching how the history row reads. */
export const formatNitoDateTime = (blockTime: number, language: LanguageCode): string =>
  `${formatNitoTime(blockTime, language)} · ${formatNitoDate(blockTime, language)}`;
