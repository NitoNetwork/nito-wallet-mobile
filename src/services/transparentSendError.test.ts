import { beforeEach, describe, expect, it, vi } from 'vitest';

import { makeTranslator } from '../i18n';
import { TransparentSendError } from '../wallet/transparentSend';
import {
  reportUnexpectedTransparentSendFailure,
  translatedTransparentSendError,
} from './transparentSendError';

const diagnostics = vi.hoisted(() => ({
  reportNonFinancialFailure: vi.fn(),
}));

vi.mock('./diagnostics', () => diagnostics);

describe('transparent send error boundary', () => {
  beforeEach(() => {
    diagnostics.reportNonFinancialFailure.mockClear();
  });

  it('translates stable domain codes instead of exposing their raw message', () => {
    const caught = new TransparentSendError('insufficient-funds');
    const message = translatedTransparentSendError(
      caught,
      makeTranslator('fr'),
      'fallback',
      'transparent send prepare',
    );

    expect(message).toBe(makeTranslator('fr')('errors.sendInsufficientFunds'));
    expect(message).not.toContain(caught.code);
    expect(diagnostics.reportNonFinancialFailure).not.toHaveBeenCalled();
  });

  it('reports unexpected failures and shows only the translated fallback', () => {
    const caught = new Error('raw signer failure');
    const message = translatedTransparentSendError(
      caught,
      makeTranslator('ja'),
      makeTranslator('ja')('errors.txPrepareFailed'),
      'transparent send prepare',
    );

    expect(message).toBe(makeTranslator('ja')('errors.txPrepareFailed'));
    expect(message).not.toContain('raw signer failure');
    expect(diagnostics.reportNonFinancialFailure).toHaveBeenCalledWith(
      'transparent send prepare',
      caught,
    );
  });

  it('reports an internal domain detail without exposing it', () => {
    const detail = new Error('m/84 private derivation failed');
    const caught = new TransparentSendError('signing-material-unavailable', detail);

    reportUnexpectedTransparentSendFailure('transparent send signing', caught);

    expect(diagnostics.reportNonFinancialFailure).toHaveBeenCalledWith(
      'transparent send signing',
      detail,
    );
  });
});
