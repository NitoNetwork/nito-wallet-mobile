import { reportNonFinancialFailure } from './diagnostics';

export type RecoveryPhraseCopyState = 'idle' | 'confirm' | 'copying' | 'copied' | 'error';

/** No phrase is retained by this controller. Each copy needs fresh consent. */
export function createRecoveryPhraseCopy({
  writeText,
  isAvailable,
  onChange,
}: {
  writeText: (text: string) => Promise<boolean>;
  isAvailable: () => boolean;
  onChange: (state: RecoveryPhraseCopyState) => void;
}) {
  let state: RecoveryPhraseCopyState = 'idle';
  let disposed = false;
  let writing = false;
  let revision = 0;
  const update = (next: RecoveryPhraseCopyState) => {
    state = next;
    if (!disposed) onChange(next);
  };
  const reset = () => {
    revision += 1;
    update('idle');
  };

  return {
    request() {
      if (!disposed && !writing && isAvailable()) update('confirm');
    },
    reset,
    async confirm(mnemonic: string) {
      if (disposed || writing || state !== 'confirm' || !isAvailable()) return;
      const operation = revision;
      writing = true;
      update('copying');
      let next: RecoveryPhraseCopyState = 'copied';
      try {
        // Copy importable words, not the grid's numbers or line breaks.
        if (!await writeText(mnemonic.trim().split(/\s+/u).join(' '))) {
          throw new Error('Clipboard write failed');
        }
      } catch {
        // Native errors must never carry phrase content into diagnostics.
        reportNonFinancialFailure('recovery phrase copy', new Error('Clipboard write failed'));
        next = 'error';
      } finally {
        writing = false;
      }
      // An already submitted native write cannot be cancelled. Never reopen
      // hidden UI or restore consent when it completes after leaving the screen.
      if (!disposed && operation === revision && isAvailable()) update(next);
    },
    dispose() {
      disposed = true;
      reset();
    },
  };
}
