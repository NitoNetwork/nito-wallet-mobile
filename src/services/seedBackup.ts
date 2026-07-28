import { wordlist } from '@scure/bip39/wordlists/english.js';

export const SEED_BACKUP_CHALLENGE_WORD_INDEXES = [2, 11, 23] as const;

export type SeedBackupChallenge = Readonly<{
  wordIndex: number;
  correctWord: string;
  options: readonly string[];
}>;

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
  wordIndex: number,
  correctWord: string,
): readonly string[] => {
  let state = stableHash(`${mnemonic}:${wordIndex}`);
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

export const createSeedBackupChallenges = (mnemonic: string): readonly SeedBackupChallenge[] => {
  const words = mnemonic.trim().toLowerCase().split(/\s+/u);
  const lastRequiredIndex = SEED_BACKUP_CHALLENGE_WORD_INDEXES.at(-1)!;
  if (words.length <= lastRequiredIndex) {
    throw new Error('A 24-word recovery phrase is required for backup verification.');
  }

  return SEED_BACKUP_CHALLENGE_WORD_INDEXES.map((wordIndex) => {
    const correctWord = words[wordIndex]!;
    return {
      wordIndex,
      correctWord,
      options: shuffledOptions(mnemonic, wordIndex, correctWord),
    };
  });
};

export const isSeedBackupChallengeAnswerCorrect = (
  challenge: SeedBackupChallenge,
  answer: string,
): boolean => answer === challenge.correctWord;
