import { describe, expect, it } from 'vitest';

import {
  createSeedBackupChallenges,
  isSeedBackupChallengeAnswerCorrect,
  nextSeedBackupConfirmationStep,
  numberSeedBackupWords,
  SEED_BACKUP_CHALLENGE_COUNT,
} from './seedBackup';

const mnemonic = 'abandon ability able about above absent absorb abstract absurd abuse access accident account accuse achieve acid acoustic acquire across act action actor actress actual';

describe('seed backup challenge', () => {
  it('keeps every displayed position and word together in the numbered backup grid', () => {
    const numberedWords = numberSeedBackupWords(mnemonic);

    expect(numberedWords).toHaveLength(24);
    expect(numberedWords).toEqual([
      '1. abandon',
      '2. ability',
      '3. able',
      '4. about',
      '5. above',
      '6. absent',
      '7. absorb',
      '8. abstract',
      '9. absurd',
      '10. abuse',
      '11. access',
      '12. accident',
      '13. account',
      '14. accuse',
      '15. achieve',
      '16. acid',
      '17. acoustic',
      '18. acquire',
      '19. across',
      '20. act',
      '21. action',
      '22. actor',
      '23. actress',
      '24. actual',
    ]);
  });

  it('asks three positions with four distinct choices and exactly one correct word', () => {
    const challenges = createSeedBackupChallenges(mnemonic, 'attempt-a');
    const words = mnemonic.split(' ');

    expect(challenges).toHaveLength(SEED_BACKUP_CHALLENGE_COUNT);
    expect(new Set(challenges.map((challenge) => challenge.wordIndex))).toHaveLength(
      SEED_BACKUP_CHALLENGE_COUNT,
    );
    for (const challenge of challenges) {
      expect(challenge.options).toHaveLength(4);
      expect(new Set(challenge.options).size).toBe(4);
      expect(challenge.options.filter((word) => word === words[challenge.wordIndex]))
        .toHaveLength(1);
    }
  });

  it('accepts only the expected word for the requested position', () => {
    const [challenge] = createSeedBackupChallenges(mnemonic, 'attempt-a');
    expect(challenge).toBeDefined();

    expect(isSeedBackupChallengeAnswerCorrect(challenge!, challenge!.correctWord)).toBe(true);
    const wrongWord = challenge!.options.find((word) => word !== challenge!.correctWord);
    expect(isSeedBackupChallengeAnswerCorrect(challenge!, wrongWord!)).toBe(false);
  });

  it('regenerates the challenge series after a failed attempt', () => {
    const first = createSeedBackupChallenges(mnemonic, 'attempt-a');
    const second = createSeedBackupChallenges(mnemonic, 'attempt-b');

    expect(first).not.toEqual(second);
  });

  it('cancels the entire series after a wrong answer instead of allowing another guess', () => {
    const [challenge] = createSeedBackupChallenges(mnemonic, 'attempt-a');
    expect(challenge).toBeDefined();
    const wrongWord = challenge!.options.find((word) => word !== challenge!.correctWord);

    expect(nextSeedBackupConfirmationStep(1, challenge!, wrongWord!)).toBe(-1);
    expect(nextSeedBackupConfirmationStep(1, challenge!, challenge!.correctWord)).toBe(2);
  });
});
