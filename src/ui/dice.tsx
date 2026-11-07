import { useLayoutEffect, useState } from 'react';
import { Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import type { Translator } from '../i18n';
import type { PendingAction } from './types';
import { ActionButton } from './components';
import {
  PHYSICAL_DICE_RESULT_COUNT,
  PHYSICAL_DICE_RESULTS_PER_SERIES,
  PHYSICAL_DICE_SERIES_COUNT,
  PhysicalDiceEntropySession,
} from './diceEntropy';
import { useStyles, useThemeColor } from './themeContext';
import { TYPOGRAPHY } from './typography';

const PHYSICAL_DICE_STYLES = StyleSheet.create({
  detailsButton: {
    minHeight: 46,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  detailsText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
    fontFamily: TYPOGRAPHY.semibold,
  },
  detailsChevron: {
    fontSize: 18,
  },
  detailsPanel: {
    borderRadius: 16,
    padding: 14,
    gap: 8,
  },
  detailsBody: {
    fontSize: 13,
    lineHeight: 19,
    fontFamily: TYPOGRAPHY.regular,
  },
  progressHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  progressText: {
    flexShrink: 1,
    fontSize: 14,
    lineHeight: 20,
    fontFamily: TYPOGRAPHY.bold,
  },
  progressTrack: {
    height: 8,
    borderRadius: 999,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
  },
  seriesRow: {
    flexDirection: 'row',
    gap: 8,
  },
  seriesSlot: {
    flex: 1,
    minWidth: 0,
    height: 48,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  seriesSlotText: {
    fontSize: 18,
    fontFamily: TYPOGRAPHY.bold,
  },
  diceGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 10,
  },
  dieButton: {
    width: '31.5%',
    minHeight: 52,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dieButtonText: {
    fontSize: 20,
    fontFamily: TYPOGRAPHY.bold,
  },
  warning: {
    fontSize: 13,
    lineHeight: 19,
    fontFamily: TYPOGRAPHY.semibold,
  },
  secondaryActions: {
    flexDirection: 'row',
    gap: 10,
  },
  secondaryAction: {
    flex: 1,
    minHeight: 48,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryActionText: {
    fontSize: 13,
    lineHeight: 18,
    fontFamily: TYPOGRAPHY.semibold,
    textAlign: 'center',
  },
});

export function DiceEntropyScreen({
  t,
  pendingAction,
  actionLocked,
  resetRef,
  onContinue,
  onBack,
}: {
  t: Translator;
  pendingAction: PendingAction | null;
  actionLocked: boolean;
  resetRef: { current: () => void };
  onContinue: (additionalEntropyBase64: string) => void;
  onBack: () => void;
}) {
  const styles = useStyles();
  const themeColor = useThemeColor();
  const [session] = useState(() => new PhysicalDiceEntropySession());
  const [count, setCount] = useState(0);
  const [detailsExpanded, setDetailsExpanded] = useState(false);

  useLayoutEffect(() => {
    const resetEntropy = () => {
      session.clear();
      setCount(0);
      setDetailsExpanded(false);
    };
    resetRef.current = resetEntropy;
    return () => {
      session.clear();
      if (resetRef.current === resetEntropy) resetRef.current = () => undefined;
    };
  }, [resetRef, session]);

  const currentSeriesIndex = Math.min(
    Math.floor(count / PHYSICAL_DICE_RESULTS_PER_SERIES),
    PHYSICAL_DICE_SERIES_COUNT - 1,
  );
  const seriesStart = currentSeriesIndex * PHYSICAL_DICE_RESULTS_PER_SERIES;
  const seriesNumber = currentSeriesIndex + 1;
  const currentSlot = count === PHYSICAL_DICE_RESULT_COUNT
    ? PHYSICAL_DICE_RESULTS_PER_SERIES
    : (count % PHYSICAL_DICE_RESULTS_PER_SERIES) + 1;

  const appendResult = (value: number) => {
    if (actionLocked || session.complete) return;
    session.append(value);
    setCount(session.count);
  };

  const undo = () => {
    if (actionLocked || !session.undo()) return;
    setCount(session.count);
  };

  const leave = () => {
    if (actionLocked) return;
    if (session.count === 0) {
      onBack();
      return;
    }
    Alert.alert(
      t('dice.cancelTitle'),
      t('dice.cancelBody', { count: session.count }),
      [
        { text: t('dice.keepEntering'), style: 'cancel' },
        {
          text: t('dice.leaveAndClear'),
          style: 'destructive',
          onPress: () => {
            session.clear();
            setCount(0);
            onBack();
          },
        },
      ],
    );
  };

  const createWithResults = () => {
    if (actionLocked || !session.complete) return;
    const additionalEntropyBase64 = session.entropyDigestBase64();
    session.clear();
    setCount(0);
    onContinue(additionalEntropyBase64);
  };

  return (
    <View style={styles.card}>
      <Text style={styles.sectionTitle}>{t('dice.title')}</Text>
      <Text style={styles.body}>{t('dice.body')}</Text>

      <TouchableOpacity
        accessibilityRole="button"
        accessibilityState={{ expanded: detailsExpanded }}
        onPress={() => setDetailsExpanded((current) => !current)}
        style={[
          PHYSICAL_DICE_STYLES.detailsButton,
          {
            backgroundColor: themeColor('#0b203a'),
            borderColor: themeColor('rgba(75, 157, 255, 0.32)'),
          },
        ]}
      >
        <Text style={[
          PHYSICAL_DICE_STYLES.detailsText,
          { color: themeColor('#dbeaff') },
        ]}>
          {t('dice.detailsTitle')}
        </Text>
        <Text
          accessible={false}
          style={[
            PHYSICAL_DICE_STYLES.detailsChevron,
            { color: themeColor('#8cc6ff') },
          ]}
        >
          {detailsExpanded ? '⌃' : '⌄'}
        </Text>
      </TouchableOpacity>

      {detailsExpanded ? (
        <View style={[
          PHYSICAL_DICE_STYLES.detailsPanel,
          { backgroundColor: themeColor('rgba(2, 6, 17, 0.62)') },
        ]}>
          <Text style={[
            PHYSICAL_DICE_STYLES.detailsBody,
            { color: themeColor('#bdc9df') },
          ]}>
            {t('dice.why100')}
          </Text>
          <Text style={[
            PHYSICAL_DICE_STYLES.detailsBody,
            { color: themeColor('#bdc9df') },
          ]}>
            {t('dice.mixExplanation')}
          </Text>
          <Text style={[
            PHYSICAL_DICE_STYLES.detailsBody,
            { color: themeColor('#bdc9df') },
          ]}>
            {t('dice.finalExplanation')}
          </Text>
        </View>
      ) : null}

      <View style={PHYSICAL_DICE_STYLES.progressHeader}>
        <Text
          accessibilityLiveRegion="polite"
          style={[
            PHYSICAL_DICE_STYLES.progressText,
            { color: themeColor('#f6f8ff') },
          ]}
        >
          {t('dice.progress', { count, total: PHYSICAL_DICE_RESULT_COUNT })}
        </Text>
        <Text style={styles.helper}>
          {t('dice.series', { current: seriesNumber, total: PHYSICAL_DICE_SERIES_COUNT })}
        </Text>
      </View>
      <View
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 0, max: PHYSICAL_DICE_RESULT_COUNT, now: count }}
        style={[
          PHYSICAL_DICE_STYLES.progressTrack,
          { backgroundColor: themeColor('rgba(126, 151, 188, 0.22)') },
        ]}
      >
        <View
          style={[
            PHYSICAL_DICE_STYLES.progressFill,
            {
              width: `${count}%`,
              backgroundColor: themeColor('#f5bd31'),
            },
          ]}
        />
      </View>

      <Text style={styles.label}>
        {t('dice.currentResult', {
          current: currentSlot,
          total: PHYSICAL_DICE_RESULTS_PER_SERIES,
        })}
      </Text>
      <View style={PHYSICAL_DICE_STYLES.seriesRow}>
        {Array.from({ length: PHYSICAL_DICE_RESULTS_PER_SERIES }, (_, offset) => {
          const position = seriesStart + offset;
          const value = session.valueAt(position);
          const active = !session.complete && position === count;
          return (
            <View
              key={position}
              accessible
              accessibilityLabel={t('dice.resultSlot', {
                position: offset + 1,
                value: value ?? t('dice.emptyResult'),
              })}
              style={[
                PHYSICAL_DICE_STYLES.seriesSlot,
                {
                  backgroundColor: active ? themeColor('#0b203a') : themeColor('#071326'),
                  borderColor: active
                    ? themeColor('rgba(245, 189, 49, 0.52)')
                    : themeColor('rgba(126, 151, 188, 0.28)'),
                },
              ]}
            >
              <Text style={[
                PHYSICAL_DICE_STYLES.seriesSlotText,
                {
                  color: value === null
                    ? themeColor('#8390a8')
                    : themeColor('#f6f8ff'),
                },
              ]}>
                {value ?? '·'}
              </Text>
            </View>
          );
        })}
      </View>

      <View style={PHYSICAL_DICE_STYLES.diceGrid}>
        {[1, 2, 3, 4, 5, 6].map((value) => (
          <TouchableOpacity
            key={value}
            accessibilityRole="button"
            accessibilityLabel={t('dice.enterResult', { value })}
            accessibilityState={{ disabled: actionLocked || session.complete }}
            disabled={actionLocked || session.complete}
            onPress={() => appendResult(value)}
            style={[
              PHYSICAL_DICE_STYLES.dieButton,
              {
                backgroundColor: themeColor('#0b203a'),
                borderColor: themeColor('rgba(75, 157, 255, 0.64)'),
                opacity: actionLocked || session.complete ? 0.45 : 1,
              },
            ]}
          >
            <Text style={[
              PHYSICAL_DICE_STYLES.dieButtonText,
              { color: themeColor('#dbeaff') },
            ]}>
              {value}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={[
        PHYSICAL_DICE_STYLES.warning,
        { color: themeColor('#ffc66d') },
      ]}>
        {t('dice.orderWarning')}
      </Text>

      <ActionButton
        label={t('dice.create')}
        loading={pendingAction === 'create'}
        disabled={actionLocked || !session.complete}
        onPress={createWithResults}
      />
      <View style={PHYSICAL_DICE_STYLES.secondaryActions}>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityState={{ disabled: actionLocked || count === 0 }}
          disabled={actionLocked || count === 0}
          onPress={undo}
          style={[
            PHYSICAL_DICE_STYLES.secondaryAction,
            {
              backgroundColor: themeColor('#071326'),
              borderColor: themeColor('rgba(126, 151, 188, 0.28)'),
              opacity: actionLocked || count === 0 ? 0.45 : 1,
            },
          ]}
        >
          <Text style={[
            PHYSICAL_DICE_STYLES.secondaryActionText,
            { color: themeColor('#9fb4d3') },
          ]}>
            {t('dice.undo')}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityState={{ disabled: actionLocked }}
          disabled={actionLocked}
          onPress={leave}
          style={[
            PHYSICAL_DICE_STYLES.secondaryAction,
            {
              backgroundColor: themeColor('#071326'),
              borderColor: themeColor('rgba(126, 151, 188, 0.28)'),
              opacity: actionLocked ? 0.45 : 1,
            },
          ]}
        >
          <Text style={[
            PHYSICAL_DICE_STYLES.secondaryActionText,
            { color: themeColor('#9fb4d3') },
          ]}>
            {t('actions.cancel')}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
