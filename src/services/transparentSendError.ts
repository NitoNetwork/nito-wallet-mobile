import type { TranslationKey, Translator } from '../i18n';
import {
  TransparentSendError,
  type TransparentSendErrorCode,
} from '../wallet/transparentSend';
import { reportNonFinancialFailure } from './diagnostics';

const TRANSPARENT_SEND_ERROR_KEYS = {
  'invalid-amount-format': 'errors.invalidAmount',
  'amount-above-max-money': 'errors.invalidAmount',
  'amount-not-positive': 'errors.invalidAmount',
  'amount-below-dust': 'errors.invalidAmount',
  'signing-material-unavailable': 'errors.txPrepareFailed',
  'legacy-signing-data-unavailable': 'errors.sendLegacyDataUnavailable',
  'no-spendable-utxo': 'errors.sendNoSpendableFunds',
  'change-address-unavailable': 'errors.txPrepareFailed',
  'recipient-required': 'errors.invalidDestination',
  'recipient-address-required': 'errors.invalidDestination',
  'recipient-output-dust': 'errors.invalidAmount',
  'max-recipient-unavailable': 'errors.txPrepareFailed',
  'insufficient-funds': 'errors.sendInsufficientFunds',
  'consolidation-not-enough-utxos': 'errors.txPrepareFailed',
  'consolidation-unavailable': 'errors.txPrepareFailed',
  'consolidation-too-large': 'errors.txPrepareFailed',
} satisfies Record<TransparentSendErrorCode, TranslationKey>;

export const reportUnexpectedTransparentSendFailure = (
  operation: string,
  caught: unknown,
): void => {
  if (caught instanceof TransparentSendError) {
    if (caught.detail !== undefined) {
      reportNonFinancialFailure(operation, caught.detail);
    }
    return;
  }
  reportNonFinancialFailure(operation, caught);
};

export const translatedTransparentSendError = (
  caught: unknown,
  t: Translator,
  fallback: string,
  operation: string,
): string => {
  if (caught instanceof TransparentSendError) {
    reportUnexpectedTransparentSendFailure(operation, caught);
    return t(TRANSPARENT_SEND_ERROR_KEYS[caught.code]);
  }
  reportUnexpectedTransparentSendFailure(operation, caught);
  return fallback;
};
