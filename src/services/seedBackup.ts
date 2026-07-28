import { wordlist } from '@scure/bip39/wordlists/english.js';

export const SEED_BACKUP_CHALLENGE_COUNT = 3;

export type SeedBackupChallenge = Readonly<{
  wordIndex: number;
  correctWord: string;
  options: readonly string[];
}>;

export const numberSeedBackupWords = (mnemonic: string): readonly string[] => (
  mnemonic
    .trim()
    .split(/\s+/u)
    .map((word, index) => `${index + 1}. ${word}`)
);

const stableHash = (value: string): number => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
};

const shuffledOptions = (
  mnemonic: string,
  attemptToken: string,
  wordIndex: number,
  correctWord: string,
): readonly string[] => {
  let state = stableHash(`${mnemonic}:${attemptToken}:options:${wordIndex}`);
  const options = new Set<string>([correctWord]);

  while (options.size < 4) {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    options.add(wordlist[state % wordlist.length]!);
  }

  const shuffled = [...options];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    const target = state % (index + 1);
    [shuffled[index], shuffled[target]] = [shuffled[target]!, shuffled[index]!];
  }
  return shuffled;
};

const challengeWordIndexes = (
  mnemonic: string,
  attemptToken: string,
  wordCount: number,
): readonly number[] => {
  let state = stableHash(`${mnemonic}:${attemptToken}:indexes`);
  const indexes = new Set<number>();

  while (indexes.size < SEED_BACKUP_CHALLENGE_COUNT) {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    indexes.add(state % wordCount);
  }

  return [...indexes];
};

export const createSeedBackupChallenges = (
  mnemonic: string,
  attemptToken = 'initial',
): readonly SeedBackupChallenge[] => {
  const words = mnemonic.trim().toLowerCase().split(/\s+/u);
  if (words.length !== 24) {
    throw new Error('A 24-word recovery phrase is required for backup verification.');
  }

  return challengeWordIndexes(mnemonic, attemptToken, words.length).map((wordIndex) => {
    const correctWord = words[wordIndex]!;
    return {
      wordIndex,
      correctWord,
      options: shuffledOptions(mnemonic, attemptToken, wordIndex, correctWord),
    };
  });
};

export const isSeedBackupChallengeAnswerCorrect = (
  challenge: SeedBackupChallenge,
  answer: string,
): boolean => answer === challenge.correctWord;

export const nextSeedBackupConfirmationStep = (
  currentStep: number,
  challenge: SeedBackupChallenge,
  answer: string,
): number => (
  isSeedBackupChallengeAnswerCorrect(challenge, answer)
    ? currentStep + 1
    : -1
);
