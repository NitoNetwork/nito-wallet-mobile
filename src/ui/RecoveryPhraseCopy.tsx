import * as Clipboard from 'expo-clipboard';
import { useLayoutEffect, useRef, useState } from 'react';
import { AppState, Text, View } from 'react-native';

import type { Translator } from '../i18n';
import { createRecoveryPhraseCopy, type RecoveryPhraseCopyState } from '../services/recoveryPhraseCopy';
import { ActionButton } from './components';
import { useStyles } from './themeContext';

/** Mounted only alongside a visible phrase, after its existing access checks. */
export function RecoveryPhraseCopy({ mnemonic, t, disabled }: {
  mnemonic: string;
  t: Translator;
  disabled: boolean;
}) {
  const styles = useStyles();
  const [state, setState] = useState<RecoveryPhraseCopyState>('idle');
  const controllerRef = useRef<ReturnType<typeof createRecoveryPhraseCopy> | null>(null);

  useLayoutEffect(() => {
    const controller = createRecoveryPhraseCopy({
      writeText: (text) => Clipboard.setStringAsync(text),
      isAvailable: () => !disabled && AppState.currentState === 'active',
      onChange: setState,
    });
    controllerRef.current = controller;
    controller.reset();
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState !== 'active') controller.reset();
    });
    return () => {
      controllerRef.current = null;
      controller.dispose();
      subscription.remove();
    };
  }, [disabled, mnemonic]);

  return (
    <View style={styles.phraseCopy}>
      {state === 'confirm' || state === 'copying' ? (
        <View style={styles.notice}>
          <Text accessibilityRole="alert" style={styles.noticeText}>
            {t('backup.clipboardWarning')}
          </Text>
          <ActionButton
            label={t('backup.confirmCopy')}
            variant="secondary"
            disabled={disabled}
            loading={state === 'copying'}
            onPress={() => { void controllerRef.current?.confirm(mnemonic); }}
          />
          <ActionButton
            label={t('actions.cancel')}
            variant="ghost"
            disabled={state === 'copying'}
            onPress={() => controllerRef.current?.reset()}
          />
        </View>
      ) : (
        <ActionButton
          label={t('backup.copyPhrase')}
          variant="secondary"
          disabled={disabled}
          onPress={() => controllerRef.current?.request()}
        />
      )}
      {state === 'copied' ? (
        <Text accessibilityLiveRegion="polite" style={styles.helper}>{t('backup.copied')}</Text>
      ) : null}
      {state === 'error' ? (
        <Text accessibilityLiveRegion="polite" style={styles.fieldError}>{t('backup.copyFailed')}</Text>
      ) : null}
    </View>
  );
}
