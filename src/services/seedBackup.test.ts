import { describe, expect, it } from 'vitest';

import {
  createSeedBackupChallenges,
  isSeedBackupChallengeAnswerCorrect,
  SEED_BACKUP_CHALLENGE_WORD_INDEXES,
} from './seedBackup';

const mnemonic = 'abandon ability able about above absent absorb abstract absurd abuse access accident account accuse achieve acid acoustic acquire across act action actor actress actual';

describe('seed backup challenge', () => {
  it('asks three positions with four distinct choices and exactly one correct word', () => {
    const challenges = createSeedBackupChallenges(mnemonic);
    const words = mnemonic.split(' ');

    expect(challenges.map((challenge) => challenge.wordIndex)).toEqual(
      [...SEED_BACKUP_CHALLENGE_WORD_INDEXES],
    );
    for (const challenge of challenges) {
      expect(challenge.options).toHaveLength(4);
      expect(new Set(challenge.options).size).toBe(4);
      expect(challenge.options.filter((word) => word === words[challenge.wordIndex]))
        .toHaveLength(1);
    }
  });

  it('accepts only the expected word for the requested position', () => {
    const [challenge] = createSeedBackupChallenges(mnemonic);
    expect(challenge).toBeDefined();

    expect(isSeedBackupChallengeAnswerCorrect(challenge!, challenge!.correctWord)).toBe(true);
    const wrongWord = challenge!.options.find((word) => word !== challenge!.correctWord);
    expect(isSeedBackupChallengeAnswerCorrect(challenge!, wrongWord!)).toBe(false);
  });

  it('produces stable choices for the same phrase without exposing a keyboard', () => {
    expect(createSeedBackupChallenges(mnemonic)).toEqual(createSeedBackupChallenges(mnemonic));
  });
});
