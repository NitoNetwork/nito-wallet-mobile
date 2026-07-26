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
