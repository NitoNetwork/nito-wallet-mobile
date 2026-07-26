import { AUTO_LOCK_TIMEOUT_MS } from '../constants/nito';

export class AutoLock {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly onLock: () => void;
  private readonly timeoutMs: number;

  constructor(onLock: () => void, timeoutMs = AUTO_LOCK_TIMEOUT_MS) {
    this.onLock = onLock;
    this.timeoutMs = timeoutMs;
  }

  resetTimer(): void {
    this.clearTimer();
    // A zero timeout means immediate locking when the app leaves the foreground.
    // AppState owns that boundary; scheduling a zero-delay foreground timer would
    // make the persisted setting impossible to change after the next unlock.
    if (this.timeoutMs === 0) {
      return;
    }
    this.timer = setTimeout(() => {
      this.onLock();
    }, this.timeoutMs);
  }

  clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  stop(): void {
    this.clearTimer();
  }
}
