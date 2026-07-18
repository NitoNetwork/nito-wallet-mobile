import { describe, expect, it } from 'vitest';

import { auditTranslationCoverage, auditTranslationQuality } from './i18n';

describe('i18n coverage', () => {
  it('does not fall back to English for critical visible wallet copy', () => {
    expect(auditTranslationCoverage()).toEqual([]);
  });

  it('contains no visibly corrupted public translation', () => {
    expect(auditTranslationQuality()).toEqual([]);
  });
});
