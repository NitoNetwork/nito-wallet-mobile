import { describe, expect, it } from 'vitest';

import { shouldShowBlockingLoadingOverlay } from './loadingPolicy';

describe('shouldShowBlockingLoadingOverlay', () => {
  it('keeps manual history resynchronization inside the visible history tab', () => {
    expect(shouldShowBlockingLoadingOverlay('resynchronizeHistory')).toBe(false);
  });

  it('keeps other exclusive actions blocking', () => {
    expect(shouldShowBlockingLoadingOverlay('history')).toBe(true);
    expect(shouldShowBlockingLoadingOverlay('broadcast')).toBe(true);
  });

  it('does not show an overlay while idle', () => {
    expect(shouldShowBlockingLoadingOverlay(null)).toBe(false);
  });
});
