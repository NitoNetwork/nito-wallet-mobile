import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type GestureResponderEvent,
} from 'react-native';

import type { Translator } from '../i18n';
import type { PendingAction } from './types';
import { ActionButton } from './components';
import {
  DICE_ENTROPY_POOL_LENGTH,
  diceEntropyPoolToBase64,
  mixDiceEntropyPool,
  packDiceEntropySample,
} from './diceEntropy';
import { useStyles, useThemeColor } from './themeContext';

const FACE_COUNT = 6;
const FACE_STEPS = 30;
const FACE_CUT_EPSILON = 0.001;
const DIE_SIZE = 132;

const FACE_INPUT_RANGE: number[] = [];
const FACE_OUTPUT_RANGES: number[][] = Array.from({ length: FACE_COUNT }, () => []);
for (let step = 0; step < FACE_STEPS; step += 1) {
  FACE_INPUT_RANGE.push(step, step + 1 - FACE_CUT_EPSILON);
  for (let face = 0; face < FACE_COUNT; face += 1) {
    const visible = step % FACE_COUNT === face ? 1 : 0;
    FACE_OUTPUT_RANGES[face]!.push(visible, visible);
  }
}
FACE_INPUT_RANGE.push(FACE_STEPS);
for (let face = 0; face < FACE_COUNT; face += 1) {
  FACE_OUTPUT_RANGES[face]!.push(FACE_STEPS % FACE_COUNT === face ? 1 : 0);
}

const PIP_SLOTS: number[][] = [
  [4],
  [0, 8],
  [0, 4, 8],
  [0, 2, 6, 8],
  [0, 2, 4, 6, 8],
  [0, 2, 3, 5, 6, 8],
];

const DICE_STYLES = StyleSheet.create({
  stage: {
    minHeight: 246,
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingTop: 18,
    paddingBottom: 22,
    overflow: 'hidden',
  },
  platform: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 10,
    height: 70,
    borderRadius: 28,
    borderWidth: 1,
  },
  contact: {
    position: 'absolute',
    bottom: 42,
    width: 110,
    height: 22,
    borderRadius: 999,
  },
  dieMotion: {
    width: DIE_SIZE,
    height: DIE_SIZE,
    marginBottom: 28,
  },
  die: {
    width: DIE_SIZE,
    height: DIE_SIZE,
    borderRadius: 30,
    borderWidth: 2,
    overflow: 'hidden',
  },
  dieEdge: {
    position: 'absolute',
    left: 8,
    right: 8,
    bottom: 5,
    height: 12,
    borderRadius: 8,
  },
  dieRim: {
    ...StyleSheet.absoluteFill,
    borderRadius: 28,
    borderWidth: 2,
  },
  face: {
    ...StyleSheet.absoluteFill,
    flexDirection: 'row',
    flexWrap: 'wrap',
    padding: 22,
  },
  pipSlot: {
    width: '33.333%',
    height: '33.333%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pip: {
    width: 17,
    height: 17,
    borderRadius: 9,
  },
  rollButton: {
    minHeight: 52,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  rollButtonText: {
    fontSize: 16,
    fontWeight: '900',
    textAlign: 'center',
  },
});

function DiceFace({
  face,
  opacity,
  pipColor,
}: {
  face: number;
  opacity: Animated.AnimatedInterpolation<number>;
  pipColor: string;
}) {
  const occupiedSlots = PIP_SLOTS[face] ?? [];
  return (
    <Animated.View
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={[DICE_STYLES.face, { opacity }]}
    >
      {Array.from({ length: 9 }, (_, slot) => (
        <View key={slot} style={DICE_STYLES.pipSlot}>
          {occupiedSlots.includes(slot) ? (
            <View style={[DICE_STYLES.pip, { backgroundColor: pipColor }]} />
          ) : null}
        </View>
      ))}
    </Animated.View>
  );
}

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
  onContinue: (userPoolBase64: string) => void;
  onBack: () => void;
}) {
  const styles = useStyles();
  const themeColor = useThemeColor();
  const [entropyPool] = useState(() => new Uint8Array(DICE_ENTROPY_POOL_LENGTH));
  const [faceCursor] = useState(() => new Animated.Value(0));
  const [motionCursor] = useState(() => new Animated.Value(0));
  const [hasRolled, setHasRolled] = useState(false);
  const [rolling, setRolling] = useState(false);
  const [result, setResult] = useState<number | null>(null);
  const [reduceMotion, setReduceMotion] = useState(false);
  const currentFaceRef = useRef(0);
  const rollCounterRef = useRef(0);
  const animationRef = useRef<Animated.CompositeAnimation | null>(null);
  const faceOpacities = useMemo(
    () => FACE_OUTPUT_RANGES.map((outputRange) => faceCursor.interpolate({
      inputRange: FACE_INPUT_RANGE,
      outputRange,
    })),
    [faceCursor],
  );

  useLayoutEffect(() => {
    const resetEntropy = () => {
      animationRef.current?.stop();
      entropyPool.fill(0);
      rollCounterRef.current = 0;
    };
    resetRef.current = resetEntropy;
    return () => {
      if (resetRef.current === resetEntropy) resetRef.current = () => undefined;
    };
  }, [entropyPool, resetRef]);

  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (mounted) setReduceMotion(enabled);
    });
    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setReduceMotion,
    );
    return () => {
      mounted = false;
      subscription.remove();
      animationRef.current?.stop();
      entropyPool.fill(0);
    };
  }, [entropyPool]);

  const translateY = motionCursor.interpolate({
    inputRange: [0, 1, 2, 3, 4, 5],
    outputRange: [0, -42, 9, -15, 5, 0],
  });
  const scaleX = motionCursor.interpolate({
    inputRange: [0, 1, 2, 3, 4, 5],
    outputRange: [1, 0.96, 1.12, 0.98, 1.07, 1],
  });
  const scaleY = motionCursor.interpolate({
    inputRange: [0, 1, 2, 3, 4, 5],
    outputRange: [1, 1.05, 0.86, 1.02, 0.92, 1],
  });
  const rotation = motionCursor.interpolate({
    inputRange: [0, 1, 2, 3, 4, 5],
    outputRange: ['0deg', '190deg', '372deg', '348deg', '366deg', '360deg'],
  });
  const contactOpacity = motionCursor.interpolate({
    inputRange: [0, 1, 2, 3, 4, 5],
    outputRange: [0.42, 0.1, 0.62, 0.2, 0.52, 0.42],
  });
  const contactScale = motionCursor.interpolate({
    inputRange: [0, 1, 2, 3, 4, 5],
    outputRange: [1, 0.5, 1.2, 0.75, 1.1, 1],
  });

  const roll = (event: GestureResponderEvent) => {
    if (rolling || actionLocked) return;
    rollCounterRef.current += 1;
    const nativeEvent = event.nativeEvent;
    const packedSample = packDiceEntropySample({
      dateNowMs: Date.now(),
      performanceNowMs: (
        typeof performance !== 'undefined' && typeof performance.now === 'function'
      ) ? performance.now() : 0,
      nativeTimestampMs: nativeEvent.timestamp,
      locationX: nativeEvent.locationX,
      locationY: nativeEvent.locationY,
      pageX: nativeEvent.pageX,
      pageY: nativeEvent.pageY,
      force: nativeEvent.force ?? 0,
      counter: rollCounterRef.current,
    });
    let nextPool: Uint8Array;
    try {
      nextPool = mixDiceEntropyPool(entropyPool, packedSample);
    } finally {
      packedSample.fill(0);
    }
    const targetFace = nextPool[0]! % FACE_COUNT;
    entropyPool.set(nextPool);
    nextPool.fill(0);

    setResult(null);
    setHasRolled(true);
    const currentFace = currentFaceRef.current;
    currentFaceRef.current = targetFace;
    if (reduceMotion) {
      faceCursor.setValue(targetFace);
      motionCursor.setValue(0);
      setResult(targetFace + 1);
      return;
    }

    setRolling(true);
    const advance = (2 * FACE_COUNT) + ((targetFace - currentFace + FACE_COUNT) % FACE_COUNT);
    motionCursor.setValue(0);
    const animation = Animated.parallel([
      Animated.timing(faceCursor, {
        toValue: currentFace + advance + 0.5,
        duration: 670,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.sequence([
        Animated.timing(motionCursor, { toValue: 1, duration: 190, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(motionCursor, { toValue: 2, duration: 210, easing: Easing.in(Easing.quad), useNativeDriver: true }),
        Animated.timing(motionCursor, { toValue: 3, duration: 110, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(motionCursor, { toValue: 4, duration: 90, easing: Easing.in(Easing.quad), useNativeDriver: true }),
        Animated.timing(motionCursor, { toValue: 5, duration: 100, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      ]),
    ]);
    animationRef.current = animation;
    animation.start(({ finished }) => {
      if (!finished) return;
      faceCursor.setValue(targetFace);
      motionCursor.setValue(0);
      animationRef.current = null;
      setRolling(false);
      setResult(targetFace + 1);
    });
  };

  return (
    <View style={styles.card}>
      <Text style={styles.sectionTitle}>{t('dice.title')}</Text>
      <Text style={styles.body}>{t('dice.body')}</Text>
      <Text style={styles.helper}>{t('dice.entropyLabel')}</Text>
      <View style={DICE_STYLES.stage}>
        <View
          style={[
            DICE_STYLES.platform,
            {
              backgroundColor: themeColor('rgba(2, 6, 17, 0.62)'),
              borderColor: themeColor('rgba(126, 151, 188, 0.14)'),
            },
          ]}
        />
        <Animated.View
          style={[
            DICE_STYLES.contact,
            {
              backgroundColor: themeColor('rgba(126, 151, 188, 0.2)'),
              opacity: contactOpacity,
              transform: [{ scaleX: contactScale }],
            },
          ]}
        />
        <Animated.View
          style={[
            DICE_STYLES.dieMotion,
            { transform: [{ translateY }, { rotate: rotation }, { scaleX }, { scaleY }] },
          ]}
        >
          <View
            style={[
              DICE_STYLES.die,
              {
                backgroundColor: themeColor('#071326'),
                borderColor: themeColor('rgba(126, 151, 188, 0.16)'),
              },
            ]}
          >
            <View
              style={[
                DICE_STYLES.dieEdge,
                { backgroundColor: themeColor('rgba(126, 151, 188, 0.16)') },
              ]}
            />
            {faceOpacities.map((opacity, face) => (
              <DiceFace
                key={face}
                face={face}
                opacity={opacity}
                pipColor={themeColor('#f6f8ff')}
              />
            ))}
            <View
              pointerEvents="none"
              style={[
                DICE_STYLES.dieRim,
                { borderColor: themeColor('rgba(91, 166, 255, 0.34)') },
              ]}
            />
          </View>
        </Animated.View>
      </View>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={t('dice.roll')}
        accessibilityHint={t('dice.rollHint')}
        accessibilityState={{ busy: rolling, disabled: rolling || actionLocked }}
        disabled={rolling || actionLocked}
        onPress={roll}
        style={[
          DICE_STYLES.rollButton,
          {
            backgroundColor: themeColor('#071326'),
            borderColor: themeColor('rgba(91, 166, 255, 0.34)'),
          },
        ]}
      >
        <Text style={[DICE_STYLES.rollButtonText, { color: themeColor('#f6f8ff') }]}>
          {t('dice.roll')}
        </Text>
      </TouchableOpacity>
      <Text accessibilityLiveRegion="polite" style={styles.tileValue}>
        {result === null ? '' : t('dice.result', { value: result })}
      </Text>
      <ActionButton
        label={t('actions.continue')}
        loading={pendingAction === 'create'}
        disabled={actionLocked || !hasRolled}
        onPress={() => onContinue(diceEntropyPoolToBase64(entropyPool))}
      />
      <ActionButton
        label={t('actions.back')}
        variant="ghost"
        disabled={actionLocked}
        onPress={onBack}
      />
    </View>
  );
}
