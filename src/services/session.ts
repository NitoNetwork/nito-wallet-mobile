import { AUTO_LOCK_TIMEOUT_MS } from '../constants/nito';

export class AutoLock {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly onLock: () => boolean | void;
  private readonly timeoutMs: number;

  constructor(onLock: () => boolean | void, timeoutMs = AUTO_LOCK_TIMEOUT_MS) {
    this.onLock = onLock;
    this.timeoutMs = timeoutMs;
  }

  resetTimer(): void {
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.onLock() === false) {
        this.resetTimer();
      }
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
