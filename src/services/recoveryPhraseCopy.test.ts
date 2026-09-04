/// <reference types="vite/client" />

import { describe, expect, it, vi } from 'vitest';

import copySource from '../ui/RecoveryPhraseCopy.tsx?raw';
import screensSource from '../ui/screens.tsx?raw';
import settingsSource from '../ui/settings.tsx?raw';
import { createRecoveryPhraseCopy, type RecoveryPhraseCopyState } from './recoveryPhraseCopy';

// Public BIP39 test-vector words, never a real wallet.
const phrase = [...Array<string>(23).fill('abandon'), 'art'].join(' ');

function setup() {
  let available = true;
  const writeText = vi.fn<(text: string) => Promise<boolean>>().mockResolvedValue(true);
  const onChange = vi.fn<(state: RecoveryPhraseCopyState) => void>();
  const controller = createRecoveryPhraseCopy({ writeText, onChange, isAvailable: () => available });
  return { controller, writeText, onChange, setAvailable: (value: boolean) => { available = value; } };
}

describe('explicit recovery phrase copy', () => {
  it('does not copy on mount, on the first press or after cancellation', async () => {
    const { controller, writeText, onChange } = setup();
    await controller.confirm(phrase);
    expect(writeText).not.toHaveBeenCalled();
    controller.request();
    expect(onChange).toHaveBeenLastCalledWith('confirm');
    expect(writeText).not.toHaveBeenCalled();
    controller.reset();
    await controller.confirm(phrase);
    expect(writeText).not.toHaveBeenCalled();
  });

  it('copies all 24 unnumbered words in order, once per confirmation', async () => {
    const { controller, writeText, onChange } = setup();
    controller.request();
    await controller.confirm(` \n${phrase.replaceAll(' ', '\n\t')}  `);
    expect(writeText).toHaveBeenCalledExactlyOnceWith(phrase);
    expect(onChange.mock.calls.map(([state]) => state)).toEqual(['confirm', 'copying', 'copied']);
    await controller.confirm(phrase);
    expect(writeText).toHaveBeenCalledTimes(1);
    controller.request();
    await controller.confirm(phrase);
    expect(writeText).toHaveBeenCalledTimes(2);
  });

  it('prevents double taps before React can render the disabled button', async () => {
    const { controller, writeText, onChange } = setup();
    let finish!: (value: boolean) => void;
    writeText.mockReturnValue(new Promise<boolean>((resolve) => { finish = resolve; }));
    controller.request();
    const copy = controller.confirm(phrase);
    controller.request();
    await controller.confirm(phrase);
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith('copying');
    finish(true);
    await copy;
    expect(onChange).toHaveBeenLastCalledWith('copied');
  });

  it('checks live availability again between requesting and confirming', async () => {
    const { controller, writeText, setAvailable } = setup();
    setAvailable(false);
    controller.request();
    await controller.confirm(phrase);
    setAvailable(true);
    controller.request();
    setAvailable(false);
    await controller.confirm(phrase);
    expect(writeText).not.toHaveBeenCalled();
  });

  it('requires new consent after the app leaves the foreground', async () => {
    const { controller, writeText, setAvailable } = setup();
    controller.request();
    setAvailable(false);
    controller.reset();
    setAvailable(true);
    await controller.confirm(phrase);
    expect(writeText).not.toHaveBeenCalled();
    controller.request();
    await controller.confirm(phrase);
    expect(writeText).toHaveBeenCalledTimes(1);
  });

  it.each(['background', 'unmount'] as const)('does not restore copy UI after %s during a native write', async (reason) => {
    const { controller, writeText, onChange } = setup();
    let finish!: (value: boolean) => void;
    writeText.mockReturnValue(new Promise<boolean>((resolve) => { finish = resolve; }));
    controller.request();
    const copy = controller.confirm(phrase);
    if (reason === 'background') controller.reset();
    else controller.dispose();
    const callsBeforeCompletion = onChange.mock.calls.length;
    finish(true);
    await copy;
    expect(onChange).toHaveBeenCalledTimes(callsBeforeCompletion);
    await controller.confirm(phrase);
    expect(writeText).toHaveBeenCalledTimes(1);
  });

  it('rejects stale button handlers after the phrase is hidden or changed', async () => {
    const { controller, writeText } = setup();
    controller.request();
    controller.dispose();
    controller.request();
    await controller.confirm(phrase);
    expect(writeText).not.toHaveBeenCalled();
  });

  it.each(['reject', 'false'] as const)('reports a %s result without exposing phrase content and requires renewed consent', async (failure) => {
    const { controller, writeText, onChange } = setup();
    const log = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    try {
      if (failure === 'reject') writeText.mockRejectedValueOnce(new Error(phrase));
      else writeText.mockResolvedValueOnce(false);
      controller.request();
      await expect(controller.confirm(phrase)).resolves.toBeUndefined();
      expect(onChange).toHaveBeenLastCalledWith('error');
      expect(log).toHaveBeenCalledExactlyOnceWith('[Nito] recovery phrase copy failed (Error).');
      await controller.confirm(phrase);
      expect(writeText).toHaveBeenCalledTimes(1);
      controller.request();
      await controller.confirm(phrase);
      expect(onChange).toHaveBeenLastCalledWith('copied');
    } finally {
      log.mockRestore();
    }
  });

  it('shares the same confirmation UI only alongside the revealed grids', () => {
    expect(screensSource).toMatch(/seedBackupRequired && pendingWallet && seedBackupConfirmationStep < 0[\s\S]*?<MnemonicGrid mnemonic=\{pendingWallet.mnemonic\} \/>\s*<RecoveryPhraseCopy mnemonic=\{pendingWallet.mnemonic\} t=\{t\} disabled=\{actionLocked\} \/>/);
    expect(settingsSource).toMatch(/settings.showMnemonic \? \([\s\S]*?<MnemonicGrid mnemonic=\{settings.wallet.mnemonic\} \/>\s*<RecoveryPhraseCopy mnemonic=\{settings.wallet.mnemonic\} t=\{t\} disabled=\{actionLocked\} \/>/);
    expect(copySource).toContain("AppState.currentState === 'active'");
    expect(copySource).toContain("if (nextState !== 'active') controller.reset();");
    expect(copySource).toContain('controller.dispose();');
    expect(copySource).toContain('subscription.remove();');
    expect(copySource).toContain('useLayoutEffect(() =>');
    expect(copySource).toContain('}, [disabled, mnemonic]);');
    expect(copySource).toContain("t('backup.clipboardWarning')");
    expect(copySource).toContain("t('backup.confirmCopy')");
    expect(copySource).toContain('void controllerRef.current?.confirm(mnemonic)');
    expect(copySource).not.toContain('onConfirmSeedBackupWord');
    expect(copySource).not.toContain('setShowMnemonic');
    expect(copySource).not.toContain('getStringAsync');
  });
});
