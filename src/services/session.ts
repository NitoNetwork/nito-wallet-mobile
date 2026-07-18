import { AUTO_LOCK_TIMEOUT_MS } from '../constants/nito';

export class AutoLock {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly onLock: () => void;
  constructor(onLock: () => void) {
    this.onLock = onLock;
  }

  resetTimer(): void {
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.onLock();
    }, AUTO_LOCK_TIMEOUT_MS);
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
