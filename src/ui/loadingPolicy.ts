import type { PendingAction } from './types';

export const shouldShowBlockingLoadingOverlay = (
  pendingAction: PendingAction | null,
): boolean => pendingAction !== null && pendingAction !== 'resynchronizeHistory';
